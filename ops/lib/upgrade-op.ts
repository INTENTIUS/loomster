/**
 * Upgrade Op factory (chant#905) — shared by the three tier-fixed Ops
 * (`../loom-upgrade-{light,production,production-ha}.op.ts`), one function so
 * the phase shape is defined once and the tier dial (chant#890) is just a
 * config flag, not three hand-copied Op bodies.
 *
 * Phases: **Snapshot -> [Approve] -> Schema -> Backend -> Apply -> [Scripts]**,
 * with `onFailure: [Rollback]` only when gated. `gated` maps to chant#905's
 * acceptance line ("prod/prod-ha carry gate + rollback; light is
 * additive/local with no gate"). The snapshot runs on every tier; only the
 * approval/rollback posture and the one-time-scripts phase are
 * tier-conditioned.
 *
 * **The schema (loomster#78).** Loom has no migration tool of its own: the
 * backend runs `create_all` plus a list of ADD COLUMN statements when a task
 * starts (`backend/app/db.py` `init_db`). loomster hands the schema to SQL
 * Yodeler instead (`../../db/`): each Loom version's change is a reviewed,
 * versioned migration, and **Schema** applies the pending ones
 * (`scripts/db/yodel.sh apply`) behind yodel's own gate, which is bound to the
 * plan digest (approve it with `just db approve`, before or after this Op
 * stops there). It runs while the old backend still serves, so a bump's
 * migration has to be one the old code tolerates, which yodel's lint and its
 * expand-and-contract steps are for. Then **Backend** rolls the new backend
 * (`chant run --components loom-backend`: build, publish, cfn-deploy, and on
 * real AWS wait-steady-state + health-gate with its own `rollback-previous`),
 * whose startup migration finds nothing left to do.
 *
 * The Op's own approval gate (gated tiers) sits before Schema, since the
 * schema change is the first irreversible step after the snapshot.
 *
 * **Scripts** (gated tiers only) runs Loom's one-time `backend/scripts/*.py`
 * named in `LOOM_UPGRADE_SCRIPTS` at run time, each as a one-off ECS task of
 * the just-rolled backend (`./backend-scripts.ts`). Empty or unset is a no-op.
 *
 * The nested component deploys run in-process like the Op itself; the
 * component driver's own saga rollback (`rollback-previous`) covers a failed
 * roll.
 */

import { Op, OpResource, phase, gate, shell } from "@intentius/chant/op";
import type { LoomNamingParams } from "../../src/lib/naming";
import { stackRefs } from "./stack-refs";
import { snapshotBeforeScript, restorePreviousScript } from "./rds-safety";
import { runBackendScriptsScript } from "./backend-scripts";

export interface LoomUpgradeOpConfig {
  naming: LoomNamingParams;
  /** `true` on `production`/`production-ha` (approval gate, one-time-scripts phase, data-safety rollback); `false` on `light` (additive, local-executor-friendly, chant#905). */
  gated: boolean;
}

/** Container name in the backend task definition (`../../src/composites/loom-backend.ts`). */
const BACKEND_CONTAINER = "backend";

/**
 * The Schema phase: apply the pending migrations of Loom's schema with SQL
 * Yodeler (`../../scripts/db/yodel.sh`, which reaches the database through
 * the SSM tunnel and runs db/'s migrate Op). It exits 3 at yodel's gate until
 * `just db approve` has approved this exact plan, and 4 when the deployment's
 * history records nothing yet (`just db baseline` first).
 */
export const SCHEMA_SCRIPT = "bash scripts/db/yodel.sh apply";

export function buildLoomUpgradeOp(config: LoomUpgradeOpConfig): InstanceType<typeof OpResource> {
  const { naming, gated } = config;
  const tier = naming.tier;
  const refs = stackRefs(naming);
  const opName = `loom-upgrade-${tier}`;

  const phases = [
    phase("Snapshot", [shell(snapshotBeforeScript({ dbInstanceIdentifier: refs.dbInstanceIdentifier }), { profile: "longInfra" })]),
  ];

  if (gated) {
    phases.push(
      phase("Approve", [
        gate(`approve-${opName}`, {
          timeout: "24h",
          description: `Approve migrating the schema (SQL Yodeler, behind its own plan-bound gate) and rolling the new Loom backend and frontend to ${tier} (env=${naming.env}, instance=${naming.instance})`,
        }),
      ]),
    );
  }

  phases.push(
    phase("Schema", [shell(SCHEMA_SCRIPT, { profile: "longInfra" })]),
    phase("Backend", [shell(`npx chant run --components loom-backend --env ${naming.env}`, { profile: "longInfra" })]),
    phase("Apply", [shell(`npx chant run --components loom-frontend --env ${naming.env}`, { profile: "longInfra" })]),
  );

  if (gated) {
    phases.push(
      phase("Scripts", [
        shell(
          runBackendScriptsScript({ cluster: refs.ecsClusterName, serviceName: refs.backendServiceName, container: BACKEND_CONTAINER }),
          { profile: "longInfra" },
        ),
      ]),
    );
  }

  // Hoisted to a const before the return (chant's EVL004 requires a spread
  // source to be a const identifier/literal, never an inline ternary).
  const onFailureConfig = gated
    ? {
        onFailure: [
          phase("Rollback", [
            shell(restorePreviousScript({ dbInstanceIdentifier: refs.dbInstanceIdentifier }), { profile: "longInfra" }),
          ]),
        ],
      }
    : {};

  return Op({
    name: opName,
    overview: `Upgrade the Loom "${tier}" deployment (env=${naming.env}): snapshot ->${gated ? " approve ->" : ""} migrate the schema (SQL Yodeler, plan-bound gate) -> roll the backend -> roll the frontend${gated ? " -> one-time scripts (LOOM_UPGRADE_SCRIPTS)" : ""}`,
    labels: { Tier: tier, Env: naming.env },
    phases,
    ...onFailureConfig,
  });
}
