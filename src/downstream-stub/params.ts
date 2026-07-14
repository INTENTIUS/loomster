import { Parameter } from "@intentius/chant-lexicon-aws";

/**
 * `shared-foundation` outputs, declared as CloudFormation parameters — the
 * `downstream-stub` component (../components/downstream-stub.component.ts)
 * fills these with `stackOutput("shared-foundation", ...)` wiring. Exists to
 * prove the named outputs resolve for a real downstream consumer (chant#886
 * acceptance: "a downstream stub component resolves at least cluster ARN,
 * listener ARN, target-group ARNs, repo URIs, and SG ids via stackOutput(...)").
 */
export const ecsClusterArn = new Parameter("String", { description: "shared-foundation ECS cluster ARN" });
export const httpsListenerArn = new Parameter("String", { description: "shared-foundation ALB HTTPS/HTTP listener ARN" });
export const frontendTargetGroupArn = new Parameter("String", { description: "shared-foundation frontend target group ARN" });
export const backendTargetGroupArn = new Parameter("String", { description: "shared-foundation backend target group ARN" });
export const frontendRepositoryUri = new Parameter("String", { description: "shared-foundation frontend ECR repository URI" });
export const backendRepositoryUri = new Parameter("String", { description: "shared-foundation backend ECR repository URI" });
export const albSecurityGroupId = new Parameter("String", { description: "shared-foundation ALB security group ID" });
export const ecsSecurityGroupId = new Parameter("String", { description: "shared-foundation ECS security group ID" });
