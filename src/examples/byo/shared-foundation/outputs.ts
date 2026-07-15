/**
 * Named outputs for the `shared-foundation` half of the BYO-everything
 * example (chant#898) — same key set as the repo's real
 * `src/shared-foundation/outputs.ts`, but every seam that's
 * `reference-existing` here (kms/ecr/route53/acm/agentRole) threads the
 * given ARN/id straight through via `literalOutputValue` instead of reading
 * it off a composite member (there is no member — reference-existing builds
 * nothing). This is the shape a downstream `loom-backend`/`loom-frontend`
 * stack's `stackOutput("shared-foundation", "<key>")` resolves either way —
 * a consumer never needs to know whether the value came from a newly
 * provisioned resource or a pre-existing one.
 */

import { output, Ref } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../../../composites/shared-foundation";
import { foundation } from "./foundation";
import * as params from "./params";

// ── Always-provisioned members (unconditional in every mode) ──────────────
export const oAlbArn = output(foundation.alb.LoadBalancerArn, "oAlbArn");
export const oAlbDnsName = output(foundation.alb.DNSName, "oAlbDnsName");
export const oHttpsListenerArn = output(foundation.httpsListener.ListenerArn, "oHttpsListenerArn");
export const oAlbSecurityGroupId = output(foundation.albSg.GroupId, "oAlbSecurityGroupId");
export const oEcsSecurityGroupId = output(foundation.ecsSg.GroupId, "oEcsSecurityGroupId");
export const oFrontendTargetGroupArn = output(foundation.frontendTargetGroup.TargetGroupArn, "oFrontendTargetGroupArn");
export const oBackendTargetGroupArn = output(foundation.backendTargetGroup.TargetGroupArn, "oBackendTargetGroupArn");
export const oArtifactBucket = output(Ref(foundation.artifactBucket), "oArtifactBucket");
export const oEcsClusterArn = output(foundation.ecsCluster.Arn, "oEcsClusterArn");

// ── Reference-existing seams — value threaded straight from params, no member built ──
export const oEcrKmsKeyArn = output(literalOutputValue(params.kms.mode === "reference-existing" ? params.kms.kmsKeyArn : ""), "oEcrKmsKeyArn");
export const oFrontendRepositoryUri = output(
  literalOutputValue(params.ecr.mode === "reference-existing" ? params.ecr.frontendRepositoryUri : ""),
  "oFrontendRepositoryUri",
);
export const oBackendRepositoryUri = output(
  literalOutputValue(params.ecr.mode === "reference-existing" ? params.ecr.backendRepositoryUri : ""),
  "oBackendRepositoryUri",
);
export const oDomainName = output(literalOutputValue(params.domainName), "oDomainName");
export const oCertificateArn = output(
  literalOutputValue(params.acm.mode === "reference-existing" ? params.acm.certificateArn : ""),
  "oCertificateArn",
);
export const oHostedZoneId = output(
  literalOutputValue(params.route53.mode === "reference-existing" ? params.route53.hostedZoneId : ""),
  "oHostedZoneId",
);
export const oAgentRoleArn = output(
  literalOutputValue(params.agentRole.mode === "reference-existing" ? params.agentRole.agentRoleArn : ""),
  "oAgentRoleArn",
);
