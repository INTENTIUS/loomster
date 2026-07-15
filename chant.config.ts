import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
// `temporal` is read for the lifecycle Ops under `ops/` (chant#904 — WatchOp
// observe + ReconcileOp cloud→code, `@intentius/chant-lexicon-temporal`).
const loomEnv = process.env.LOOM_ENV ?? "dev";

export default {
  lexicons: ["aws", "temporal"],
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
        // evaluable. src/lib/** and .chant/rules/** are plain runtime
        // helpers (the naming/tagging helper, project-local lint rules) —
        // never a composite property expression — so they're out of scope.
        files: ["src/lib/**", ".chant/rules/**"],
        rules: { EVL003: "off", EVL004: "off" },
      },
    ],
  },
} satisfies ChantConfig;
