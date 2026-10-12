import { phase, type Component } from "@intentius/chant/components";
import { sharedFoundationStackName } from "../lib/component-stack-names";

/**
 * The shared infrastructure every Loom service/agent attaches to: the ALB +
 * listener/rules/target-groups, ECS cluster, 2 ECR repos, KMS key, S3
 * artifact bucket, DNS (Route53 zone + record, ACM cert on production/
 * production-ha), security groups, PrivateLink `VPCEndpointService`, and the
 * agent IAM role — one CloudFormation stack (chant#886).
 *
 * `infra` archetype — no build, just apply. The template is what
 * `chant build src/shared-foundation --lexicon aws` synthesizes from
 * `../composites/shared-foundation.ts`. Named outputs
 * (`src/shared-foundation/outputs.ts`) are what #887 (RDS)/#888 (Cognito)/
 * #889 (ECS services) attach to via `stackOutput("shared-foundation", ...)`.
 */
export const sharedFoundation: Component = {
  name: "shared-foundation",
  archetype: "infra",
  dependsOn: [],
  deploy: [
    // Synthesize this stack's template on the deploy path. cfn-deploy reads
    // `dist/shared-foundation.template.json` from disk and `chant run --components`
    // never builds it, so without this phase a deploy applies whatever stale
    // template is lying in dist/ (or fails in a fresh checkout). The build
    // reads the LOOM_* env vars the run was started with
    // (test/claims/params/reach-deploy.sh).
    phase("Synth", [
      {
        kind: "shell",
        cmd: "npm run -s synth:shared-foundation",
        reason: "synthesize dist/shared-foundation.template.json from the run's build params before cfn-deploy reads it; no verb builds a lexicon stack inside a component run",
      },
    ]),
    phase("Apply", [
      { kind: "cfn-deploy", stack: sharedFoundationStackName, template: "dist/shared-foundation.template.json" },
    ]),
  ],
};
