/**
 * Named outputs for the `shared-foundation` stack (chant#886) — the exact key
 * set Loom's own `infra.yaml`/`dns.yaml`/`ecs.yaml`/`role.yaml` expose,
 * preserved so downstream stacks resolve them by the same convention:
 * `stackOutput("shared-foundation", "<key>")`.
 *
 * Which of these exist, and whether each carries a resource attribute or a
 * reference-existing literal, is decided by `sharedFoundationOutputs` in
 * `./output-set.ts` — see its header for why that is a function call here
 * rather than the ternaries this file used to spell inline (loomster#160).
 */

import { foundation } from "./foundation";
import * as params from "./params";
import { network } from "./network";
import { sharedFoundationOutputs } from "./output-set";

export const {
  oVpcId,
  oPublicSubnetIds,
  oPrivateSubnetIds,
  oAlbArn,
  oAlbDnsName,
  oHttpsListenerArn,
  oAlbSecurityGroupId,
  oEcsSecurityGroupId,
  oFrontendTargetGroupArn,
  oBackendTargetGroupArn,
  oEcrKmsKeyArn,
  oFrontendRepositoryUri,
  oBackendRepositoryUri,
  oArtifactBucket,
  oDomainName,
  oCertificateArn,
  oHostedZoneId,
  oEcsClusterArn,
  oEcsClusterName,
  oAgentRoleArn,
} = sharedFoundationOutputs(foundation, network, params);
