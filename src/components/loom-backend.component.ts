import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../loom-backend/params";

/**
 * The `loom-backend` service (chant#889) — build (`docker-build` ->
 * archive) -> publish (`publish-image`, promote by digest) -> apply
 * (`cfn-deploy`), with a `rollback-previous` compensation phase. The
 * template is what `chant build src/loom-backend --lexicon aws`
 * synthesizes from `../composites/loom-backend.ts`. Build → Publish →
 * Apply → Verify → Rollback, mirroring the reference preset; the only
 * omission is a standalone `ecs-update-service` step, redundant here because
 * `cfn-deploy` rolls the image via a new `TaskDefinition` revision.
 *
 * **Docker build context.** Loom's application source (the `backend/`
 * directory + its `Dockerfile`) is not vendored into this repo — it lives
 * upstream at `awslabs/loom` (pinned `v1.6.0`). `npm run vendor`
 * (`scripts/vendor-loom.sh`) fetches it into `vendor/loom` (gitignored)
 * before running a real deploy; `context`/`dockerfile` below assume that
 * layout. None of this component's gates (typecheck/lint/test/synth/`chant
 * graph --components`) touch the filesystem at this path — only an actual
 * `chant run` does.
 *
 * **Context is the vendor root, not `vendor/loom/backend`.** Loom's own
 * `backend/Dockerfile` `COPY`s two things from *outside* `backend/`:
 * `agents/strands_agent/src/` and its `requirements.txt` (the comment inline
 * in that Dockerfile — "Agent source for build_agent_artifact
 * (deployment.py resolves via parents[3] -> /)" — is Loom's own backend
 * bundling its low-code agent's source into the same image so it can build
 * that agent's deploy artifact at runtime). A context scoped to
 * `vendor/loom/backend` alone can't see those paths and the build fails;
 * `vendor/loom` (the repo root) plus `dockerfile: "backend/Dockerfile"` is
 * the layout Loom's own `shared/makefile`
 * (`podman build -f ../backend/Dockerfile ..`, run from `shared/`) actually
 * uses. Verified by building this exact Dockerfile/context pair with real
 * `docker build` against a real `v1.6.0` checkout while wiring this up
 * (#20) — the image builds clean.
 *
 * **`dockerfile` is context-relative** (chant#936, fixed in 0.18.17).
 * `realDocker.build` now joins `dockerfile` onto `context` before invoking
 * `docker build`, matching `DockerBuildInput.dockerfile`'s docstring
 * ("relative to context"). So `dockerfile` here is `backend/Dockerfile`,
 * relative to the `vendor/loom` context — not the old project-root path.
 *
 * **Preset gap note (chant#889 acceptance criterion).** This hand-composes
 * the same Publish -> Apply -> Verify -> Rollback shape
 * `EcsFargateComponent` (`packages/core/src/components/presets/
 * ecs-fargate.ts`, in the `chant` repo) provides, rather than calling the
 * preset directly, because two of its convenience fields carry fixed keys
 * that do not fit Loom's real contract:
 *  1. `sharedAlbStack` always emits exactly `ListenerArn`/`ClusterArn`/
 *     `Subnets` as cross-stack inputs. This stack needs nine inputs across
 *     three stacks (shared-foundation/loom-db/loom-cognito), under
 *     shared-foundation's own real output names (`oEcsClusterArn`,
 *     `oBackendTargetGroupArn`, ...) — none of which match the preset's
 *     fixed set. Covered by wiring every input explicitly through the
 *     generic `inputs` map below instead of `sharedAlbStack`.
 *  2. `imageRef` always targets a CFN Parameter literally named `ImageRef`.
 *     Loom's real template parameter is `pImageUri` (chant#889's settled
 *     decision: preserve Loom's own parameter names for 1:1 fidelity, the
 *     same reasoning `shared-foundation`/`loom-db`/`loom-cognito`'s
 *     `outputs.ts` already apply to output keys). Covered by wiring the
 *     published image through `inputs.pImageUri` instead of `imageRef`.
 * Everything else the preset provides (build -> publish -> apply ->
 * ecs-update-service -> wait-steady-state -> health-gate -> rollback-
 * previous) is exactly this component's own shape — the preset's pipeline
 * fits; only its two fixed-key conveniences don't.
 */

const naming = loomNaming(namingParams, "loom-backend");
const serviceName = naming.name("backend-svc");
const clusterArn = stackOutput(sn("shared-foundation"), "oEcsClusterArn");
// Verify runs the runtime health checks: the service reaches steady state
// (`wait-steady-state`, guarding Floci's missing `deployments` field via
// chant#937), then an HTTP health check through the shared ALB (`health-gate`,
// composing a real URL from the ALB DNS via its `host` field, chant#939). Both
// are real-AWS checks. A local emulator (Floci sets `AWS_ENDPOINT_URL`)
// provisions the control plane and every stack reaches CREATE_COMPLETE, but it
// does not run the app workload: the backend needs a reachable RDS/Cognito and
// its task never starts (runningCount stays 0), and the ALB does not serve the
// ALB->ECS HTTP data path. So neither check can pass against Floci (verified
// live, loomster#37) — against an emulator the deploy proves synthesis and
// deployability through Apply, and Verify is skipped. On real AWS the full
// runtime Verify runs. (Held in a const so the `deploy` spread references a
// const, not a ternary — chant's EVL004 lint rule.)
const onRealAws = !process.env.AWS_ENDPOINT_URL;
// Full tiers serve HTTPS-only on the custom domain (no HTTP listener on the prod
// ALB), so probe `https://<domain>/health`; light uses the ALB's own HTTP DNS
// name. Found live (loomster#125) — see loom-frontend.component.ts for the detail.
const fullTier = namingParams.tier !== "light";
const domain = process.env.LOOM_DOMAIN_NAME;
const healthGateHost = fullTier && domain ? `https://${domain}` : stackOutput(sn("shared-foundation"), "oAlbDnsName");
const verifyPhases = onRealAws
  ? [
      phase("Verify", [
        { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
        { kind: "health-gate", host: healthGateHost, path: "/health" },
      ]),
    ]
  : [];

export const loomBackend: Component = {
  name: "loom-backend",
  archetype: "service",
  dependsOn: ["shared-foundation", "loom-db", "loom-cognito"],
  build: { kind: "docker-build", context: "vendor/loom", dockerfile: "backend/Dockerfile", into: "archive" },
  deploy: [
    // `build` above is descriptive metadata only (introspection/CI-YAML
    // generation) — chant's local `interpret` driver (`chant run
    // --components`) only ever executes `deploy`'s own phases
    // (`runComponentDeploy` in @intentius/chant's driver.ts iterates
    // `component.deploy`, never `component.build`), so the actual
    // `docker-build` step has to be a real phase here too, or "Publish"'s
    // `from: "archive"` has nothing to load (chant#928/loomster#35 — same
    // gap found live on `loom-frontend.component.ts`).
    phase("Build", [
      { kind: "docker-build", context: "vendor/loom", dockerfile: "backend/Dockerfile", into: "archive" },
    ]),
    phase("Publish", [
      { kind: "publish-image", from: "archive", to: stackOutput(sn("shared-foundation"), "oBackendRepositoryUri") },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: sn("loom-backend"),
        template: "dist/loom-backend.template.json",
        inputs: {
          pEcsClusterArn: clusterArn,
          pEcsClusterName: stackOutput(sn("shared-foundation"), "oEcsClusterName"),
          pEcsSecurityGroupId: stackOutput(sn("shared-foundation"), "oEcsSecurityGroupId"),
          pTargetGroupArn: stackOutput(sn("shared-foundation"), "oBackendTargetGroupArn"),
          pArtifactBucket: stackOutput(sn("shared-foundation"), "oArtifactBucket"),
          pEcrKmsKeyArn: stackOutput(sn("shared-foundation"), "oEcrKmsKeyArn"),
          pPrivateSubnetIds: stackOutput(sn("shared-foundation"), "oPrivateSubnetIds"),
          pDatabaseSecretArn: stackOutput(sn("loom-db"), "oRdsSecretArn"),
          pSecretsKmsKeyArn: stackOutput(sn("loom-db"), "oSecretsKmsKeyArn"),
          // Light-tier plain DB URL (#46): resolved endpoint/port from loom-db.
          // Harmless (defaulted, unused) on production/production-ha, which keep
          // the Secrets-Manager DB-URL secret.
          pRdsEndpoint: stackOutput(sn("loom-db"), "oRdsEndpoint"),
          pRdsPort: stackOutput(sn("loom-db"), "oRdsPort"),
          pCognitoUserPoolId: stackOutput(sn("loom-cognito"), "oCognitoUserPoolId"),
          pImageUri: "@Publish.uri",
        },
      },
      // No separate `ecs-update-service` step by design: `cfn-deploy` already
      // rolls the new image out via a new `TaskDefinition` revision on the
      // `EcsService` resource, so a force-new-deployment is redundant here.
      // (chant#937 fixed its Floci crash, but the redundancy argument stands.)
    ]),
    // Verify (real-AWS only) — see `verifyPhases` above for the full reasoning.
    ...verifyPhases,
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
