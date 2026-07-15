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
 * (`./loom-backend.component.ts`). No separate `ecs-update-service` step
 * between Apply and Verify — see the Apply phase's own comment for why
 * (chant#928/loomster#35).
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
 * **`dockerfile` is CWD-relative, not context-relative** (chant#928/
 * loomster#35, found live). `DockerBuildInput.dockerfile`'s own docstring
 * says "relative to context", but `@intentius/chant`'s `realDocker.build`
 * (`components/verbs/cloud-executor.ts`) passes it straight through as
 * `docker build -f <dockerfile> <context>` with no join against `context` —
 * Docker CLI itself resolves a relative `-f` against the process's current
 * directory, not the context directory. `chant run` always executes from
 * the project root, so `dockerfile` here is the full project-root-relative
 * path (`vendor/loom/frontend/Dockerfile`), not `Dockerfile` alone.
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
  build: { kind: "docker-build", context: "vendor/loom/frontend", dockerfile: "vendor/loom/frontend/Dockerfile", into: "archive" },
  deploy: [
    // `build` above is descriptive metadata only (introspection/CI-YAML
    // generation) — chant's local `interpret` driver (`chant run
    // --components`) only ever executes `deploy`'s own phases
    // (`runComponentDeploy` in @intentius/chant's driver.ts iterates
    // `component.deploy`, never `component.build`), so the actual
    // `docker-build` step has to be a real phase here too, or "Publish"'s
    // `from: "archive"` has nothing to load (chant#928/loomster#35 —
    // found live: `docker load -i 'archive'` failed with no such file,
    // since nothing had ever produced it).
    phase("Build", [
      { kind: "docker-build", context: "vendor/loom/frontend", dockerfile: "vendor/loom/frontend/Dockerfile", into: "archive" },
    ]),
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
          pPublicSubnetIds: stackOutput("shared-foundation", "oPublicSubnetIds"),
          pImageUri: "@Publish.uri",
        },
      },
      // No separate `ecs-update-service` step (chant#928/loomster#35, found
      // live): `cfn-deploy` above already rolls the new image out — a fresh
      // `pImageUri` digest produces a new `TaskDefinition` revision baked
      // into the `EcsService` resource, and CloudFormation natively updates
      // + waits on the service when that property changes, so nothing here
      // is lost by not also calling `ecs-update-service`. That capability's
      // real implementation (`@intentius/chant-lexicon-aws`'s
      // `cloud-executor.ts`) crashes unconditionally against Floci:
      // `described.service.deployments[0]?.id` throws when `deployments` is
      // absent from the response, which is exactly what Floci's `ecs
      // update-service` returns (verified live) — real AWS always includes
      // it. Filed upstream; re-add once fixed, for the redundant
      // force-a-fresh-deployment-with-the-same-image case this step alone
      // covers.
    ]),
    phase("Verify", [
      { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
      { kind: "health-gate", path: "/" },
    ]),
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
