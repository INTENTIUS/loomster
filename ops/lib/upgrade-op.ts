/**
 * Upgrade Op factory (chant#905) — shared by the three tier-fixed Ops
 * (`../loom-upgrade-{light,production,production-ha}.op.ts`), one function so
 * the phase shape is defined once and the tier dial (chant#890) is just a
 * config flag, not three hand-copied Op bodies.
 *
 * Phases: **Snapshot -> [Approve] -> Migrate -> Apply -> [Scripts]**, with
 * `onFailure: [Rollback]` only when gated. `gated` maps to chant#905's
 * acceptance line ("prod/prod-ha carry gate + rollback; light is
 * additive/local with no gate"). The snapshot runs on every tier; only the
 * approval/rollback posture and the one-time-scripts phase are
 * tier-conditioned.
 *
 * **Loom's migration model (loomster#5).** Loom has no Alembic or other
 * migration tool. The backend migrates its own schema when a new task starts
 * (`backend/app/db.py` `init_db`: `create_all` plus `_migrate_add_columns`).
 * So "Migrate" is the backend component deploy itself: `chant run
 * --components loom-backend` (`../../src/components/loom-backend.component.ts`:
 * docker-build from `vendor/loom` -> publish-image -> cfn-deploy, which
 * registers a new task-definition revision and rolls the service -> Verify:
 * wait-steady-state + health-gate on real AWS, with its own
 * `rollback-previous` compensation). Steady state plus a passing `/health` is
 * the signal that the new tasks started and migrated. This Op does not repeat
 * that roll/verify logic.
 *
 * Because the migration is the cutover, the approval gate sits before
 * Migrate.
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
          description: `Approve rolling the new Loom backend (it migrates the schema on startup) and frontend to ${tier} (env=${naming.env}, instance=${naming.instance})`,
        }),
      ]),
    );
  }

  phases.push(
    phase("Migrate", [shell(`npx chant run --components loom-backend --env ${naming.env}`, { profile: "longInfra" })]),
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
    overview: `Upgrade the Loom "${tier}" deployment (env=${naming.env}): snapshot ->${gated ? " approve ->" : ""} roll the backend (schema migrates on startup) -> roll the frontend${gated ? " -> one-time scripts (LOOM_UPGRADE_SCRIPTS)" : ""}`,
    labels: { Tier: tier, Env: naming.env },
    phases,
    ...onFailureConfig,
  });
}
