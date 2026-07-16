import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
// `temporal` is read for the lifecycle Ops under `ops/` (chant#904 — WatchOp
// observe + ReconcileOp cloud→code, `@intentius/chant-lexicon-temporal`).
const loomEnv = process.env.LOOM_ENV ?? "dev";

export default {
  lexicons: ["aws", "temporal", "docker"],
  // Scope whole-project discovery (bare `chant lifecycle diff|snapshot`, the
  // path WatchOp/ReconcileOp use) to `src/`, so it never walks `docs-site/`'s
  // Astro config (`astro:`-scheme imports the ESM loader rejects) or `test/`
  // fixtures (loomster#94). Per-stack (`chant build src/<stack>`), component
  // (`chant build --components`), and Ops (`chant build ops`) commands pass
  // their own explicit path and are unaffected.
  sourceDir: "src",
  // Whatever LOOM_ENV this build/lint/lifecycle invocation targets is the
  // only allowed environment — same single-deployment-at-a-time convention
  // every src/*/params.ts file already follows.
  environments: [loomEnv],
  // Stamps a chant ownership marker (tags `chant:managed-by`/`chant:stack`/
  // `chant:env`) onto every supported resource, so `loom-reconcile`'s
  // `scope: { owned: true }` (ops/loom-reconcile.op.ts, chant#904) can scope
  // its cloud→code PRs to chant-owned resources and never touch a foreign
  // one (chant#897).
  ownership: { stack: "loom", env: loomEnv },
  lint: {
    overrides: [
      {
        // EVL003/EVL004 keep composite/component authoring code statically
        // evaluable. src/lib/**, .chant/rules/**, and ops/** are plain
        // runtime helpers (the naming/tagging helper, project-local lint
        // rules, the lifecycle Ops' Temporal workflow-definition code,
        // chant#905) — never a composite property expression — so they're
        // out of scope. EVL004 in particular only traces a spread source to
        // a *module-top-level* const declaration (see
        // packages/core/src/lint/rules/evl004-spread-non-const.ts's
        // `isConstIdentifier`), so it cannot see a const declared inside an
        // ordinary function body — exactly the shape an Op-factory function
        // (e.g. ops/lib/upgrade-op.ts's `buildLoomUpgradeOp`) needs for its
        // tier-conditioned `onFailure`/step lists.
        files: ["src/lib/**", ".chant/rules/**", "ops/**"],
        rules: { EVL003: "off", EVL004: "off" },
      },
      {
        // scripts/** (chant#901's export-bundle tooling) is the same class
        // of plain runtime/tooling code as ops/** above — it drives chant's
        // programmatic build API and assembles/validates a Build Archive
        // manifest, never a composite property expression. EVL002 in
        // particular has no way to distinguish `new SomeError(...)` (a
        // plain thrown error, conditionally constructed as ordinary control
        // flow) from a genuine Declarable resource constructor, so a
        // tier/component loop that throws a validation error per iteration
        // trips it the same way EVL003's dynamic property access does for
        // `Record<string, ...>` lookups keyed by a loop variable (component
        // name, tier name) — again, not a composite prop expression.
        files: ["scripts/**"],
        rules: { EVL002: "off", EVL003: "off", EVL004: "off" },
      },
      {
        // src/local/** is the docker-lexicon local-run compose graph (#49,
        // epic #45) — Service/Network props for `docker-compose.yml`, not AWS
        // CloudFormation composites. They use the docker lexicon's own `env()`
        // interpolation (resolved by docker compose at runtime as `${VAR}`),
        // which chant's AWS-oriented EVL static-evaluability rules misflag as
        // non-literal resource-constructor properties.
        files: ["src/local/**"],
        rules: { EVL001: "off", EVL002: "off", EVL003: "off", EVL004: "off" },
      },
    ],
  },
} satisfies ChantConfig;
