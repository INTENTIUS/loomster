/**
 * Upgrade Op factory (chant#905) — shared by the three tier-fixed Ops
 * (`../loom-upgrade-{light,production,production-ha}.op.ts`), one function so
 * the phase shape is defined once and the tier dial (chant#890) is just a
 * config flag, not three hand-copied Op bodies.
 *
 * Phases: **Snapshot -> Migrate -> [Approve] -> Apply**, `onFailure: [Rollback]`
 * only when gated. `gated` maps directly to chant#905's acceptance line
 * ("prod/prod-ha carry gate + rollback; light is additive/local with no
 * gate") — everything about the safety posture (snapshot before mutating,
 * migrate before cutover) applies unconditionally to every tier; only the
 * approval/rollback posture is tier-conditioned.
 *
 * **Promote-by-digest, no rebuild.** The Apply phase below runs
 * `chant run --components loom-backend|loom-frontend` — deploying the
 * already-published image through the exact service components chant#889
 * built (`../../src/components/{loom-backend,loom-frontend}.component.ts`:
 * publish-image -> cfn-deploy -> ecs-update-service -> wait-steady-state ->
 * health-gate, with a `rollback-previous` compensation phase of its own).
 * `runComponentDeploy` (chant core's component driver) never invokes a
 * component's `build` field itself — only `deploy` — so this genuinely never
 * rebuilds; it promotes whatever archive a prior `chant build` produced. This
 * Op does not duplicate that apply/verify/rollback logic (chant#905: "no new
 * primitives") — it wraps it with the two things it lacks: RDS data-safety
 * ahead of it, and (gated tiers) a durable approval + a data-safety rollback
 * around it.
 *
 * Runs the nested component deploys on the **local** executor (no
 * `--temporal`) even for gated tiers: the outer Op already gives this whole
 * step Temporal's durability (retry, crash-resume of the activity); nesting a
 * second durable workflow inside one activity buys nothing extra, and the
 * component driver's saga rollback (`rollback-previous`) already runs
 * identically on the local executor (`docs/components/orchestration.mdx`
 * — "The saga mechanism ... runs identically on the local executor and on
 * Temporal").
 */

import { Op, phase, gate, shell } from "@intentius/chant-lexicon-temporal";
import { OpResource } from "@intentius/chant/op";
import type { LoomNamingParams } from "../../src/lib/naming";
import { stackRefs } from "./stack-refs";
import { snapshotBeforeScript, restorePreviousScript, runMigrationScript } from "./rds-safety";

export interface LoomUpgradeOpConfig {
  naming: LoomNamingParams;
  /** `true` on `production`/`production-ha` (approval gate + data-safety rollback); `false` on `light` (additive, local-executor-friendly, chant#905). */
  gated: boolean;
}

/** Migration container command — env-driven (`LOOM_MIGRATION_COMMAND`, comma-separated argv) because Loom's actual migration entrypoint is only known once `vendor/loom` is checked out (see README.md's "Docker build context" note); defaults to a placeholder Alembic invocation to keep the Op runnable/testable before that's wired up. */
function migrationCommand(): string[] {
  const raw = process.env.LOOM_MIGRATION_COMMAND ?? "python,-m,alembic,upgrade,head";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Private subnet ids the migration task runs in — the same `LOOM_PRIVATE_SUBNET_IDS` baseline every stack's own `params.ts` reads (e.g. `../../src/loom-db/params.ts`). */
function migrationSubnetIds(): string[] {
  return (process.env.LOOM_PRIVATE_SUBNET_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function buildLoomUpgradeOp(config: LoomUpgradeOpConfig): InstanceType<typeof OpResource> {
  const { naming, gated } = config;
  const tier = naming.tier;
  const refs = stackRefs(naming);
  const opName = `loom-upgrade-${tier}`;
  const securityGroupId = process.env.LOOM_ECS_SECURITY_GROUP_ID ?? "";

  const phases = [
    phase("Snapshot", [shell(snapshotBeforeScript({ dbInstanceIdentifier: refs.dbInstanceIdentifier }), { profile: "longInfra" })]),
    phase("Migrate", [
      shell(
        runMigrationScript({
          cluster: refs.ecsClusterName,
          taskFamily: refs.backendTaskFamily,
          command: migrationCommand(),
          subnetIds: migrationSubnetIds(),
          securityGroupId,
        }),
        { profile: "longInfra" },
      ),
    ]),
  ];

  if (gated) {
    phases.push(
      phase("Approve", [
        gate(`approve-${opName}`, {
          timeout: "24h",
          description: `Approve promoting the new Loom image to ${tier} (env=${naming.env}, instance=${naming.instance})`,
        }),
      ]),
    );
  }

  phases.push(
    phase("Apply", [
      shell(`npx chant run --components loom-backend --env ${naming.env}`, { profile: "longInfra" }),
      shell(`npx chant run --components loom-frontend --env ${naming.env}`, { profile: "longInfra" }),
    ]),
  );

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
    overview: `Promote-by-digest upgrade of the Loom "${tier}" deployment (env=${naming.env}): snapshot -> migrate${gated ? " -> approve" : ""} -> apply`,
    taskQueue: "loom-lifecycle",
    searchAttributes: { Tier: tier, Env: naming.env },
    phases,
    ...onFailureConfig,
  });
}
