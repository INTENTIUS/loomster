import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../loom-backend/params";

/**
 * The `loom-backend` service (chant#889) — build (`docker-build` ->
 * archive) -> publish (`publish-image`, promote by digest) -> apply
 * (`cfn-deploy`) -> verify (`wait-steady-state` + `health-gate`), with a
 * `rollback-previous` compensation phase. The template is what
 * `chant build src/loom-backend --lexicon aws` synthesizes from
 * `../composites/loom-backend.ts`.
 *
 * **Docker build context.** Loom's application source (the `backend/`
 * directory + its `Dockerfile`) is not vendored into this repo — it lives
 * upstream at `awslabs/loom` (pinned `v1.6.0`, see the repo README). Check
 * that repo out at `vendor/loom` (gitignored) before running a real deploy;
 * `context` below assumes that layout. None of this component's gates
 * (typecheck/lint/test/synth/`chant graph --components`) touch the
 * filesystem at this path — only an actual `chant run` does.
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
  build: { kind: "docker-build", context: "vendor/loom/backend", into: "archive" },
  deploy: [
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
          pDatabaseSecretArn: stackOutput("loom-db", "oRdsSecretArn"),
          pSecretsKmsKeyArn: stackOutput("loom-db", "oSecretsKmsKeyArn"),
          pCognitoUserPoolId: stackOutput("loom-cognito", "oCognitoUserPoolId"),
          pImageUri: "@Publish.uri",
        },
      },
      { kind: "ecs-update-service", cluster: clusterArn, service: serviceName },
    ]),
    phase("Verify", [
      { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
      { kind: "health-gate", path: "/health" },
    ]),
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
