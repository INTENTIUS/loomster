/**
 * Named outputs for the `shared-foundation` stack (chant#886) — the exact
 * key set Loom's own `infra.yaml`/`dns.yaml`/`ecs.yaml`/`role.yaml` expose,
 * preserved so downstream stacks resolve them by the same convention:
 * `stackOutput("shared-foundation", "<key>")`.
 *
 * `oCertificateArn` and `oHostedZoneId` only exist on production/
 * production-ha (chant#890 tiering — ACM/Route53 are absent on light).
 *
 * `oVpcId`/`oPublicSubnetIds`/`oPrivateSubnetIds` (chant#928/loomster#35) —
 * the network this stack owns, either provisioned itself (light tier, no
 * external network env vars) or threaded straight through from
 * `network.mode: "reference-existing"` (prod BYO). Every downstream
 * network-dependent consumer (loom-db, loom-backend, loom-frontend,
 * loom-agents) reads these instead of its own `LOOM_VPC_ID`/`LOOM_*_SUBNET_IDS`
 * env vars, so light tier is fully self-contained. CloudFormation Outputs
 * can't be lists, so the subnet id lists are comma-joined into a single
 * string here via `joinOutputValues` (an `Fn::Sub`, not `Fn::Join` — see
 * that helper's own docstring for why); consumers `Fn::Split` them back
 * apart.
 */

import { output, Ref } from "@intentius/chant-lexicon-aws";
import { foundation } from "./foundation";
import { namingParams, domainName } from "./params";
import { network } from "./network";
import { loomNaming } from "../lib/naming";
import { literalOutputValue, joinOutputValues } from "../composites/shared-foundation";

const naming = loomNaming(namingParams, "shared-foundation");
const fullTier = namingParams.tier !== "light";

// ── network (provisioned light-tier VPC, or the given reference-existing one) ──
export const oVpcId = output(
  network.mode === "provision" ? foundation.vpc!.VpcId : literalOutputValue(network.vpcId),
  "oVpcId",
);

// publicSubnetIds always exists: 2 provisioned public subnets (light,
// network.mode "provision") or the given ids (reference-existing).
const publicSubnetIdList: string[] = network.mode === "provision"
  ? [foundation.publicSubnet1!.SubnetId as string, foundation.publicSubnet2!.SubnetId as string]
  : network.publicSubnetIds;
export const oPublicSubnetIds = output(joinOutputValues(publicSubnetIdList), "oPublicSubnetIds");

// privateSubnetIds: the provisioned light-tier network never creates private
// subnets (2 public subnets only, see buildProvisionedNetwork in
// ../composites/shared-foundation.ts), and reference-existing may also omit
// them (only required once PrivateLink is active, full tier). Either way,
// fall back to the same public subnets the ALB uses — correct for
// light/local, and harmless for a reference-existing network genuinely
// without a separate private tier.
const referenceExistingPrivateSubnetIds = network.mode === "reference-existing" ? network.privateSubnetIds : undefined;
const privateSubnetIdList: string[] =
  referenceExistingPrivateSubnetIds && referenceExistingPrivateSubnetIds.length > 0
    ? referenceExistingPrivateSubnetIds
    : publicSubnetIdList;
export const oPrivateSubnetIds = output(joinOutputValues(privateSubnetIdList), "oPrivateSubnetIds");

// ── infra.yaml ────────────────────────────────────────────────────────────
export const oAlbArn = output(foundation.alb.LoadBalancerArn, "oAlbArn");
export const oAlbDnsName = output(foundation.alb.DNSName, "oAlbDnsName");
export const oHttpsListenerArn = output(foundation.httpsListener.ListenerArn, "oHttpsListenerArn");
export const oAlbSecurityGroupId = output(foundation.albSg.GroupId, "oAlbSecurityGroupId");
export const oEcsSecurityGroupId = output(foundation.ecsSg.GroupId, "oEcsSecurityGroupId");
export const oFrontendTargetGroupArn = output(foundation.frontendTargetGroup.TargetGroupArn, "oFrontendTargetGroupArn");
export const oBackendTargetGroupArn = output(foundation.backendTargetGroup.TargetGroupArn, "oBackendTargetGroupArn");
// kms/ecr/agentRole are left at their composite default ("provision") in
// ./foundation.ts, so these members always exist for this deployment — the
// `!` reflects that choice, not a general guarantee (a caller that switches
// a seam to "reference-existing"/"omit" would need to adjust these too).
export const oEcrKmsKeyArn = output(foundation.kmsKey!.Arn, "oEcrKmsKeyArn");
export const oFrontendRepositoryUri = output(foundation.frontendRepo!.RepositoryUri, "oFrontendRepositoryUri");
export const oBackendRepositoryUri = output(foundation.backendRepo!.RepositoryUri, "oBackendRepositoryUri");
export const oArtifactBucket = output(Ref(foundation.artifactBucket), "oArtifactBucket");

// A custom domain is known at author time (a literal, not a stack
// attribute); on light tier there is none, so fall back to the ALB's own
// DNS name — matches "light runs ALB DNS + HTTP only" (chant#890).
export const oDomainName = domainName
  ? output(literalOutputValue(domainName), "oDomainName")
  : output(foundation.alb.DNSName, "oDomainName");

export const oCertificateArn = fullTier
  ? output(Ref(foundation.certificate!), "oCertificateArn")
  : undefined;

// ── dns.yaml (bonus — not in Loom's infra.yaml output set, but genuinely useful downstream) ──
export const oHostedZoneId = fullTier
  ? output(Ref(foundation.hostedZone!), "oHostedZoneId")
  : undefined;

// ── ecs.yaml ──────────────────────────────────────────────────────────────
export const oEcsClusterArn = output(foundation.ecsCluster.Arn, "oEcsClusterArn");
// ClusterName is an input prop, not a resource attribute — derive the exact
// same literal the composite set it to (see ../composites/shared-foundation.ts).
export const oEcsClusterName = output(literalOutputValue(naming.name("cluster")), "oEcsClusterName");

// ── role.yaml ─────────────────────────────────────────────────────────────
export const oAgentRoleArn = output(foundation.agentRole!.Arn, "oAgentRoleArn");
