import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../loom-frontend/params";

/**
 * The `loom-frontend` service (chant#889) — build (`docker-build` ->
 * archive) -> publish (`publish-image`, promote by digest) -> apply
 * (`cfn-deploy`) -> verify (`wait-steady-state` + `health-gate`), with a
 * `rollback-previous` compensation phase. The template is what
 * `chant build src/loom-frontend --lexicon aws` synthesizes from
 * `../composites/loom-frontend.ts`. Depends on `shared-foundation` only —
 * no `loom-db`/`loom-cognito` wiring, unlike `loom-backend`
 * (`./loom-backend.component.ts`).
 *
 * **Docker build context.** Same note as `loom-backend.component.ts`:
 * Loom's `frontend/` source + Dockerfile lives upstream at `awslabs/loom`
 * (pinned `v1.6.0`), fetched via `npm run vendor` (`scripts/vendor-loom.sh`)
 * into `vendor/loom` (gitignored) before a real deploy — not required for
 * this component's typecheck/lint/test/synth gates, only for an actual
 * `chant run`. Unlike `loom-backend`, the frontend's `Dockerfile` only
 * `COPY`s paths from inside `frontend/` itself (`package*.json`, then `.`),
 * so its context is `vendor/loom/frontend` directly — no repo-root context
 * needed here. Matches Loom's own `frontend/makefile`
 * (`podman build ... ../frontend`, no `-f`, so Dockerfile resolves to
 * `frontend/Dockerfile` by the default). Verified by building this
 * Dockerfile/context pair with real `docker build` while wiring this up
 * (#20) — the image builds clean and serves `/` over nginx. The Dockerfile's
 * two build args (`VITE_API_BASE_URL`, `VITE_COGNITO_USER_CLIENT_ID`) both
 * default to `""`, matching Loom's own `podman.build.frontend` target, which
 * only ever overrides the Cognito one — not wired through `buildArgs` here
 * either, so both stay their Loom-default empty string until a real
 * adopter deploy decides otherwise.
 *
 * **Preset gap note** — same two gaps `loom-backend.component.ts` documents
 * in full (`sharedAlbStack`'s fixed `ListenerArn`/`ClusterArn`/`Subnets`
 * keys vs. shared-foundation's real output names; `imageRef`'s fixed
 * `ImageRef` parameter name vs. Loom's real `pImageUri`), so this hand-
 * composes from the same `EcsFargateComponent` preset shape too, wiring
 * every input through the generic `inputs` map instead.
 */

const naming = loomNaming(namingParams, "loom-frontend");
const serviceName = naming.name("frontend-svc");
const clusterArn = stackOutput("shared-foundation", "oEcsClusterArn");

export const loomFrontend: Component = {
  name: "loom-frontend",
  archetype: "service",
  dependsOn: ["shared-foundation"],
  build: { kind: "docker-build", context: "vendor/loom/frontend", dockerfile: "Dockerfile", into: "archive" },
  deploy: [
    phase("Publish", [
      { kind: "publish-image", from: "archive", to: stackOutput("shared-foundation", "oFrontendRepositoryUri") },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "loom-frontend",
        template: "dist/loom-frontend.template.json",
        inputs: {
          pEcsClusterArn: clusterArn,
          pEcsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
          pTargetGroupArn: stackOutput("shared-foundation", "oFrontendTargetGroupArn"),
          pImageUri: "@Publish.uri",
        },
      },
      { kind: "ecs-update-service", cluster: clusterArn, service: serviceName },
    ]),
    phase("Verify", [
      { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
      { kind: "health-gate", path: "/" },
    ]),
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
