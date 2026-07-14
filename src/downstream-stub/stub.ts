import { SsmParameter } from "@intentius/chant-lexicon-aws";
import {
  ecsClusterArn,
  httpsListenerArn,
  frontendTargetGroupArn,
  backendTargetGroupArn,
  frontendRepositoryUri,
  backendRepositoryUri,
  albSecurityGroupId,
  ecsSecurityGroupId,
} from "./params";
import { loomNaming } from "../lib/naming";
import { namingParams } from "../shared-foundation/params";

/**
 * Registers each `shared-foundation` output this stub was handed (see
 * ./params.ts) as its own SSM parameter — a minimal, real downstream
 * consumer proving the named outputs resolve end to end (chant#886).
 *
 * Each `Value` embeds the CFN `Parameter` declarable directly (not
 * `Ref(param)`) — chant's EVL001 requires resource constructor properties to
 * be statically evaluable, and a bare identifier reference already
 * serializes to `{ Ref: <parameter> }`, same as an explicit `Ref(...)` would.
 */
const naming = loomNaming(namingParams, "downstream-stub");

const ecsClusterArnEchoName = naming.name("ecs-cluster-arn");
const httpsListenerArnEchoName = naming.name("https-listener-arn");
const frontendTargetGroupArnEchoName = naming.name("frontend-target-group-arn");
const backendTargetGroupArnEchoName = naming.name("backend-target-group-arn");
const frontendRepositoryUriEchoName = naming.name("frontend-repository-uri");
const backendRepositoryUriEchoName = naming.name("backend-repository-uri");
const albSecurityGroupIdEchoName = naming.name("alb-security-group-id");
const ecsSecurityGroupIdEchoName = naming.name("ecs-security-group-id");

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const ecsClusterArnEcho = new SsmParameter({
  Name: ecsClusterArnEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oEcsClusterArn",
  Value: ecsClusterArn,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const httpsListenerArnEcho = new SsmParameter({
  Name: httpsListenerArnEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oHttpsListenerArn",
  Value: httpsListenerArn,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const frontendTargetGroupArnEcho = new SsmParameter({
  Name: frontendTargetGroupArnEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oFrontendTargetGroupArn",
  Value: frontendTargetGroupArn,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const backendTargetGroupArnEcho = new SsmParameter({
  Name: backendTargetGroupArnEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oBackendTargetGroupArn",
  Value: backendTargetGroupArn,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const frontendRepositoryUriEcho = new SsmParameter({
  Name: frontendRepositoryUriEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oFrontendRepositoryUri",
  Value: frontendRepositoryUri,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const backendRepositoryUriEcho = new SsmParameter({
  Name: backendRepositoryUriEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oBackendRepositoryUri",
  Value: backendRepositoryUri,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const albSecurityGroupIdEcho = new SsmParameter({
  Name: albSecurityGroupIdEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oAlbSecurityGroupId",
  Value: albSecurityGroupId,
});

// chant-disable-next-line COR004 -- discovered by chant build, not referenced in this file.
export const ecsSecurityGroupIdEcho = new SsmParameter({
  Name: ecsSecurityGroupIdEchoName,
  Type: "String",
  Description: "Echo of shared-foundation's oEcsSecurityGroupId",
  Value: ecsSecurityGroupId,
});
