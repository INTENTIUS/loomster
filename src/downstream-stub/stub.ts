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
import {
  ecsClusterArnEchoName,
  httpsListenerArnEchoName,
  frontendTargetGroupArnEchoName,
  backendTargetGroupArnEchoName,
  frontendRepositoryUriEchoName,
  backendRepositoryUriEchoName,
  albSecurityGroupIdEchoName,
  ecsSecurityGroupIdEchoName,
} from "./names";

/**
 * Registers each `shared-foundation` output this stub was handed (see
 * ./params.ts) as its own SSM parameter — a minimal, real downstream
 * consumer proving the named outputs resolve end to end (chant#886).
 *
 * Each `Value` embeds the CFN `Parameter` declarable directly (not
 * `Ref(param)`) — chant's EVL001 requires resource constructor properties to
 * be statically evaluable, and a bare identifier reference already
 * serializes to `{ Ref: <parameter> }`, same as an explicit `Ref(...)` would.
 *
 * The physical names come from `./names.ts` rather than a `naming.name(...)`
 * call here — see that file for why a call in this position can never fold
 * (loomster#160).
 */

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
