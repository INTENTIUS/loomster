import { phase, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";

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
 * #889 (ECS services) attach to via `stackOutput(sn("shared-foundation"), ...)`.
 */
export const sharedFoundation: Component = {
  name: "shared-foundation",
  archetype: "infra",
  dependsOn: [],
  deploy: [
    phase("Apply", [
      { kind: "cfn-deploy", stack: sn("shared-foundation"), template: "dist/shared-foundation.template.json" },
    ]),
  ],
};
