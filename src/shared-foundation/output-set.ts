/**
 * `shared-foundation`'s named-output set (loomster#160) — the exact key set
 * Loom's own `infra.yaml`/`dns.yaml`/`ecs.yaml`/`role.yaml` expose, preserved
 * so downstream stacks resolve them by the same convention:
 * `stackOutput("shared-foundation", "<key>")`.
 *
 * The logic lives behind one call for the reason `../loom-db/output-set.ts`'s
 * header gives: every seam-backed output is "resource attribute, or the
 * reference-existing literal, or nothing", and the literal arm is a
 * `literalOutputValue(...)` call. chant's reducer handles a ternary but has no
 * call case, and it reduces only the TAKEN branch — so written inline, this
 * file folded on a light-tier build and fell back to run the moment a seam
 * was pointed at something existing. Foldability that depends on the build's
 * inputs is not a property worth keeping.
 *
 * `oCertificateArn` and `oHostedZoneId` only exist on production/production-ha
 * (chant#890 tiering — ACM/Route53 are absent on light).
 *
 * `oVpcId`/`oPublicSubnetIds`/`oPrivateSubnetIds` (chant#928/loomster#35) —
 * the network this stack owns, either provisioned itself (light tier, no
 * external network inputs) or threaded straight through from
 * `network.mode: "reference-existing"` (prod BYO). Every downstream
 * network-dependent consumer (loom-db, loom-backend, loom-frontend,
 * loom-agents) reads these instead of its own `LOOM_VPC_ID`/`LOOM_*_SUBNET_IDS`
 * inputs, so light tier is fully self-contained. CloudFormation Outputs can't
 * be lists, so the subnet id lists are joined into a single string via
 * `joinOutputValues` (`SUBNET_LIST_DELIMITER` — `:`, not `,`; see that
 * constant's own docstring for why); consumers `Fn::Split` on the same
 * constant to get the list back.
 */

import { output, Ref, type LexiconOutput } from "@intentius/chant-lexicon-aws";
import type { CompositeInstance } from "@intentius/chant";
import {
  literalOutputValue,
  joinOutputValues,
  type SharedFoundationResult,
  type NetworkSeam,
  type Route53Seam,
  type AcmSeam,
  type KmsSeam,
  type EcrSeam,
  type AgentRoleSeam,
} from "../composites/shared-foundation";
import { loomName, type LoomNamingParams } from "../lib/naming";

export interface SharedFoundationOutputsInput {
  namingParams: LoomNamingParams;
  domainName: string | undefined;
  route53: Route53Seam | undefined;
  acm: AcmSeam | undefined;
  kms: KmsSeam | undefined;
  ecr: EcrSeam | undefined;
  agentRole: AgentRoleSeam | undefined;
}

export interface SharedFoundationOutputs {
  oVpcId: LexiconOutput;
  oPublicSubnetIds: LexiconOutput;
  oPrivateSubnetIds: LexiconOutput;
  oAlbArn: LexiconOutput;
  oAlbDnsName: LexiconOutput;
  oHttpsListenerArn: LexiconOutput;
  oAlbSecurityGroupId: LexiconOutput;
  oEcsSecurityGroupId: LexiconOutput;
  oFrontendTargetGroupArn: LexiconOutput;
  oBackendTargetGroupArn: LexiconOutput;
  oEcrKmsKeyArn: LexiconOutput | undefined;
  oFrontendRepositoryUri: LexiconOutput | undefined;
  oBackendRepositoryUri: LexiconOutput | undefined;
  oArtifactBucket: LexiconOutput;
  oDomainName: LexiconOutput;
  oCertificateArn: LexiconOutput | undefined;
  oHostedZoneId: LexiconOutput | undefined;
  oEcsClusterArn: LexiconOutput;
  oEcsClusterName: LexiconOutput;
  oAgentRoleArn: LexiconOutput | undefined;
}

export function sharedFoundationOutputs(
  foundation: CompositeInstance<SharedFoundationResult> & SharedFoundationResult,
  network: NetworkSeam,
  input: SharedFoundationOutputsInput,
): SharedFoundationOutputs {
  const fullTier = input.namingParams.tier !== "light";
  const provisionedNetwork = network.mode === "provision";

  // publicSubnetIds always exists: 2 provisioned public subnets (light,
  // network.mode "provision") or the given ids (reference-existing).
  const publicSubnetIdList: string[] = provisionedNetwork
    ? [foundation.publicSubnet1!.SubnetId as string, foundation.publicSubnet2!.SubnetId as string]
    : (network as Extract<NetworkSeam, { mode: "reference-existing" }>).publicSubnetIds;

  // privateSubnetIds: the provisioned light-tier network never creates private
  // subnets (2 public subnets only, see buildProvisionedNetwork in
  // ../composites/shared-foundation.ts), and reference-existing may also omit
  // them (only required once PrivateLink is active, full tier). Either way,
  // fall back to the same public subnets the ALB uses — correct for
  // light/local, and harmless for a reference-existing network genuinely
  // without a separate private tier.
  const referenceExistingPrivateSubnetIds =
    network.mode === "reference-existing" ? network.privateSubnetIds : undefined;
  const privateSubnetIdList: string[] =
    referenceExistingPrivateSubnetIds && referenceExistingPrivateSubnetIds.length > 0
      ? referenceExistingPrivateSubnetIds
      : publicSubnetIdList;

  const { domainName, route53, acm, kms, ecr, agentRole } = input;

  return {
    // ── network (provisioned light-tier VPC, or the given reference-existing one) ──
    oVpcId: output(
      provisionedNetwork
        ? foundation.vpc!.VpcId
        : literalOutputValue((network as Extract<NetworkSeam, { mode: "reference-existing" }>).vpcId),
      "oVpcId",
    ),
    oPublicSubnetIds: output(joinOutputValues(publicSubnetIdList), "oPublicSubnetIds"),
    oPrivateSubnetIds: output(joinOutputValues(privateSubnetIdList), "oPrivateSubnetIds"),

    // ── infra.yaml ──────────────────────────────────────────────────────────
    oAlbArn: output(foundation.alb.LoadBalancerArn, "oAlbArn"),
    oAlbDnsName: output(foundation.alb.DNSName, "oAlbDnsName"),
    oHttpsListenerArn: output(foundation.httpsListener.ListenerArn, "oHttpsListenerArn"),
    oAlbSecurityGroupId: output(foundation.albSg.GroupId, "oAlbSecurityGroupId"),
    oEcsSecurityGroupId: output(foundation.ecsSg.GroupId, "oEcsSecurityGroupId"),
    oFrontendTargetGroupArn: output(foundation.frontendTargetGroup.TargetGroupArn, "oFrontendTargetGroupArn"),
    oBackendTargetGroupArn: output(foundation.backendTargetGroup.TargetGroupArn, "oBackendTargetGroupArn"),

    // kms/ecr/agentRole (#120) honour their seams the same way the DNS outputs
    // do: reference-existing threads the given arn/uri literal (no resource
    // member exists to Ref/GetAtt); omit emits no output; unset/provision
    // GetAtts the member the composite built. These are not tier-gated — every
    // tier builds (or references) ECR + KMS + the agent role.
    oEcrKmsKeyArn:
      kms?.mode === "omit"
        ? undefined
        : kms?.mode === "reference-existing"
          ? output(literalOutputValue(kms.kmsKeyArn), "oEcrKmsKeyArn")
          : output(foundation.kmsKey!.Arn, "oEcrKmsKeyArn"),
    oFrontendRepositoryUri:
      ecr?.mode === "omit"
        ? undefined
        : ecr?.mode === "reference-existing"
          ? output(literalOutputValue(ecr.frontendRepositoryUri), "oFrontendRepositoryUri")
          : output(foundation.frontendRepo!.RepositoryUri, "oFrontendRepositoryUri"),
    oBackendRepositoryUri:
      ecr?.mode === "omit"
        ? undefined
        : ecr?.mode === "reference-existing"
          ? output(literalOutputValue(ecr.backendRepositoryUri), "oBackendRepositoryUri")
          : output(foundation.backendRepo!.RepositoryUri, "oBackendRepositoryUri"),
    oArtifactBucket: output(Ref(foundation.artifactBucket), "oArtifactBucket"),

    // A custom domain is known at author time (a literal, not a stack
    // attribute); on light tier there is none, so fall back to the ALB's own
    // DNS name — matches "light runs ALB DNS + HTTP only" (chant#890).
    oDomainName: domainName
      ? output(literalOutputValue(domainName), "oDomainName")
      : output(foundation.alb.DNSName, "oDomainName"),

    // production/production-ha only, and only when the seam actually built a
    // cert. reference-existing threads the given ARN (no
    // `foundation.certificate` member exists to Ref); omit / light emit no
    // output at all (#117).
    oCertificateArn:
      !fullTier || acm?.mode === "omit"
        ? undefined
        : acm?.mode === "reference-existing"
          ? output(literalOutputValue(acm.certificateArn), "oCertificateArn")
          : output(Ref(foundation.certificate!), "oCertificateArn"),

    // ── dns.yaml (bonus — not in Loom's infra.yaml output set, but genuinely useful downstream) ──
    oHostedZoneId:
      !fullTier || route53?.mode === "omit"
        ? undefined
        : route53?.mode === "reference-existing"
          ? output(literalOutputValue(route53.hostedZoneId), "oHostedZoneId")
          : output(Ref(foundation.hostedZone!), "oHostedZoneId"),

    // ── ecs.yaml ────────────────────────────────────────────────────────────
    oEcsClusterArn: output(foundation.ecsCluster.Arn, "oEcsClusterArn"),
    // ClusterName is an input prop, not a resource attribute — derive the exact
    // same literal the composite set it to (see ../composites/shared-foundation.ts).
    oEcsClusterName: output(
      literalOutputValue(loomName(input.namingParams, "shared-foundation", "cluster")),
      "oEcsClusterName",
    ),

    // ── role.yaml ───────────────────────────────────────────────────────────
    oAgentRoleArn:
      agentRole?.mode === "omit"
        ? undefined
        : agentRole?.mode === "reference-existing"
          ? output(literalOutputValue(agentRole.agentRoleArn), "oAgentRoleArn")
          : output(foundation.agentRole!.Arn, "oAgentRoleArn"),
  };
}
