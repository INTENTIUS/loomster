import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../loom-frontend/params";

/**
 * The `loom-frontend` service (chant#889) — build (`docker-build` ->
 * archive) -> publish (`publish-image`, promote by digest) -> apply
 * (`cfn-deploy`), with a `rollback-previous` compensation phase. The
 * template is what `chant build src/loom-frontend --lexicon aws`
 * synthesizes from `../composites/loom-frontend.ts`. Depends on
 * `shared-foundation` only — no `loom-db`/`loom-cognito` wiring, unlike
 * `loom-backend` (`./loom-backend.component.ts`). Build → Publish → Apply →
 * Verify → Rollback; the only omission vs the reference preset is a
 * standalone `ecs-update-service` step, redundant because `cfn-deploy`
 * rolls the image via a new `TaskDefinition` revision.
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
 * **`dockerfile` is context-relative** (chant#936, fixed in 0.18.17).
 * `realDocker.build` now joins `dockerfile` onto `context`, so `dockerfile`
 * here is just `Dockerfile`, relative to the `vendor/loom/frontend` context.
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
// Verify runs the runtime health checks: the service reaches steady state
// (`wait-steady-state`, chant#937), then an HTTP health check through the
// shared ALB against `/` (nginx serves the SPA at root; `health-gate` composes
// a real URL from the ALB DNS via its `host` field, chant#939). Both are
// real-AWS checks — a local emulator (Floci sets `AWS_ENDPOINT_URL`) deploys
// the control plane but does not serve the ALB->ECS HTTP data path, so
// `health-gate` can't pass (verified live, loomster#37). Gated as a whole for
// symmetry with `loom-backend`, whose task can't even start on Floci. On real
// AWS the full Verify runs. (Held in a const so the `deploy` spread references
// a const, not a ternary — chant's EVL004 lint rule.)
const onRealAws = !process.env.AWS_ENDPOINT_URL;
// The full tiers (production / production-ha) serve HTTPS-only on the custom
// domain — the prod ALB has no HTTP listener — so the health-gate must probe
// `https://<domain>`. Light serves HTTP on the ALB's own DNS name. Found live
// (loomster#125): an http:// probe to the HTTPS-only prod ALB gets no listener
// (000) and the gate false-fails even though the app is healthy. The health-gate
// `host` honors a full URL scheme and prepends http:// only to a bare host.
const fullTier = namingParams.tier !== "light";
const domain = process.env.LOOM_DOMAIN_NAME;
const healthGateHost = fullTier && domain ? `https://${domain}` : stackOutput("shared-foundation", "oAlbDnsName");
const verifyPhases = onRealAws
  ? [
      phase("Verify", [
        { kind: "wait-steady-state", service: serviceName, cluster: clusterArn },
        { kind: "health-gate", host: healthGateHost, path: "/" },
      ]),
    ]
  : [];

export const loomFrontend: Component = {
  name: "loom-frontend",
  archetype: "service",
  dependsOn: ["shared-foundation"],
  build: { kind: "docker-build", context: "vendor/loom/frontend", dockerfile: "Dockerfile", into: "archive" },
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
      { kind: "docker-build", context: "vendor/loom/frontend", dockerfile: "Dockerfile", into: "archive" },
    ]),
    phase("Publish", [
      { kind: "publish-image", from: "archive", to: stackOutput("shared-foundation", "oFrontendRepositoryUri") },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: sn("loom-frontend"),
        template: "dist/loom-frontend.template.json",
        inputs: {
          pEcsClusterArn: clusterArn,
          pEcsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
          pTargetGroupArn: stackOutput("shared-foundation", "oFrontendTargetGroupArn"),
          pPublicSubnetIds: stackOutput("shared-foundation", "oPublicSubnetIds"),
          pImageUri: "@Publish.uri",
        },
      },
      // No separate `ecs-update-service` step by design: `cfn-deploy` above
      // already rolls the new image out — a fresh `pImageUri` digest produces
      // a new `TaskDefinition` revision on the `EcsService`, which CFN updates
      // and waits on natively, so a force-new-deployment is redundant here.
      // (chant#937 fixed its Floci crash, but the redundancy argument stands.)
    ]),
    // Verify (real-AWS only) — see `verifyPhases` above for the full reasoning.
    ...verifyPhases,
  ],
  rollback: [phase("Rollback", [{ kind: "rollback-previous", service: serviceName, cluster: clusterArn }])],
};
