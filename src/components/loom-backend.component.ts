import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../loom-backend/params";

/**
 * The `loom-backend` service (chant#889) — build (`docker-build` ->
 * archive) -> publish (`publish-image`, promote by digest) -> apply
 * (`cfn-deploy`) -> verify (`wait-steady-state` + `health-gate`), with a
 * `rollback-previous` compensation phase. The template is what
 * `chant build src/loom-backend --lexicon aws` synthesizes from
 * `../composites/loom-backend.ts`. No separate `ecs-update-service` step
 * between Apply and Verify (unlike the reference preset this mirrors — see
 * the Apply phase's own comment for why, chant#928/loomster#35).
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
 * **`dockerfile` is CWD-relative, not context-relative** (chant#928/
 * loomster#35, found live). `DockerBuildInput.dockerfile`'s own docstring
 * says "relative to context", but `@intentius/chant`'s `realDocker.build`
 * (`components/verbs/cloud-executor.ts`) passes it straight through as
 * `docker build -f <dockerfile> <context>` with no join against `context` —
 * Docker CLI itself resolves a relative `-f` against the process's current
 * directory, not the context directory. `chant run` always executes from
 * the project root, so `dockerfile` here is the full project-root-relative
 * path (`vendor/loom/backend/Dockerfile`), not `backend/Dockerfile` alone.
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
const clusterArn = stackOutput("shared-foundation", "oEcsClusterArn");

export const loomBackend: Component = {
  name: "loom-backend",
  archetype: "service",
  dependsOn: ["shared-foundation", "loom-db", "loom-cognito"],
  build: { kind: "docker-build", context: "vendor/loom", dockerfile: "vendor/loom/backend/Dockerfile", into: "archive" },
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
      { kind: "docker-build", context: "vendor/loom", dockerfile: "vendor/loom/backend/Dockerfile", into: "archive" },
    ]),
    phase("Publish", [
      { kind: "publish-image", from: "archive", to: stackOutput("shared-foundation", "oBackendRepositoryUri") },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "loom-backend",
        template: "dist/loom-backend.template.json",
        inputs: {
          pEcsClusterArn: clusterArn,
          pEcsClusterName: stackOutput("shared-foundation", "oEcsClusterName"),
          pEcsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
          pTargetGroupArn: stackOutput("shared-foundation", "oBackendTargetGroupArn"),
          pArtifactBucket: stackOutput("shared-foundation", "oArtifactBucket"),
          pEcrKmsKeyArn: stackOutput("shared-foundation", "oEcrKmsKeyArn"),
          pPrivateSubnetIds: stackOutput("shared-foundation", "oPrivateSubnetIds"),
          pDatabaseSecretArn: stackOutput("loom-db", "oRdsSecretArn"),
          pSecretsKmsKeyArn: stackOutput("loom-db", "oSecretsKmsKeyArn"),
          pCognitoUserPoolId: stackOutput("loom-cognito", "oCognitoUserPoolId"),
          pImageUri: "@Publish.uri",
        },
      },
      // No separate `ecs-update-service` step — same reasoning as
      // `loom-frontend.component.ts` (chant#928/loomster#35, found live):
      // `cfn-deploy` already rolls the new image out via a new
      // `TaskDefinition` revision on the `EcsService` resource, and
      // `ecs-update-service`'s real implementation crashes unconditionally
      // against Floci (`described.service.deployments[0]?.id` throws when
      // `deployments` is absent from the response, which is what Floci's
      // `ecs update-service` returns — verified live). Filed upstream.
    ]),
    phase("Verify", [
      { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
      { kind: "health-gate", path: "/health" },
    ]),
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
