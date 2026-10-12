/**
 * Named outputs for the `loom-tunnel-host` stack: ec2.yaml's own keys
 * (`oInstanceId`, `oInstanceType`), which `scripts/tunnel.sh` reads, plus the
 * host's security group.
 */

import { output, Ref } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../composites/shared-foundation";
import { DEFAULT_TUNNEL_INSTANCE_TYPE } from "../composites/loom-tunnel-host";
import { tunnelHost } from "./host";
import { instanceType } from "./params";

export const oInstanceId = tunnelHost ? output(Ref(tunnelHost.instance), "oInstanceId") : undefined;
export const oInstanceType = tunnelHost
  ? output(literalOutputValue(instanceType ?? DEFAULT_TUNNEL_INSTANCE_TYPE), "oInstanceType")
  : undefined;
export const oSecurityGroupId = tunnelHost ? output(tunnelHost.securityGroup.GroupId, "oSecurityGroupId") : undefined;
