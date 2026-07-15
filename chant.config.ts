import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
export default {
  lexicons: ["aws"],
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
    ],
  },
} satisfies ChantConfig;
