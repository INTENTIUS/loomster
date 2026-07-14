import type { ChantConfig } from "@intentius/chant";

// Loom's real footprint (ALB, ECS, RDS, Cognito, ECR, KMS, S3, PrivateLink) is
// standard CloudFormation — the aws lexicon types all of it, no synthesis gap.
export default {
  lexicons: ["aws"],
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
