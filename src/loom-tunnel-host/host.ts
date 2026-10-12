/**
 * The deployable `loom-tunnel-host` stack (loomster#37): one
 * `LoomTunnelHost(...)` call, the chant version of Loom's
 * `backend/iac/ec2.yaml`. Deployed by `chant run loom-tunnel-host`, never by
 * `chant run --components`. Zero resource constructors of its own.
 */

import { LoomTunnelHost } from "../composites/loom-tunnel-host";
import * as params from "./params";

export const tunnelHost = params.vpcId
  ? LoomTunnelHost({
      naming: params.namingParams,
      vpcId: params.vpcId,
      subnetIds: params.subnetIds,
      instanceType: params.instanceType,
      dbSecurityGroupId: params.dbSecurityGroupId,
      dbPort: params.dbPort,
      ssmEndpoints: params.ssmEndpoints,
    })
  : undefined;
