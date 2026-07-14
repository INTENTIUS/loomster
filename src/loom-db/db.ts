/**
 * The deployable `loom-db` stack (chant#887) — RDS Postgres, subnet group,
 * KMS, the two Secrets Manager secrets, and (production/production-ha) the
 * RDS Proxy + secret rotation. One `LoomDb(...)` call; `data.mode` defaults
 * to "provision" (see ../composites/loom-db.ts). Assembles the `data` seam
 * from `./params.ts` — this file has zero resource constructors of its own,
 * so none of chant's EVL rules apply to it.
 */

import { Ref } from "@intentius/chant-lexicon-aws";
import { LoomDb, type DataSeam } from "../composites/loom-db";
import * as params from "./params";

function buildData(): DataSeam {
  if (params.dataMode === "omit") {
    return { mode: "omit" };
  }

  if (params.dataMode === "reference-existing") {
    return {
      mode: "reference-existing",
      endpoint: params.referenceEndpoint as string,
      port: params.referencePort,
      dbName: params.dbName,
      credentialsSecretArn: params.referenceCredentialsSecretArn as string,
      connectionSecretArn: params.referenceConnectionSecretArn,
    };
  }

  return {
    mode: "provision",
    network: { vpcId: params.vpcId as string, subnetIds: params.dbSubnetIds as string[] },
    dbIngress: params.useSourceSecurityGroup
      ? { mode: "security-group", sourceSecurityGroupId: Ref(params.ecsSecurityGroupId) as unknown as string }
      : { mode: "cidr", cidr: params.allowedCidr },
    dbName: params.dbName,
    dbUsername: params.dbUsername,
    dbPassword: params.dbPassword as string,
    dbInstanceClass: params.dbInstanceClass,
    dbAllocatedStorage: params.dbAllocatedStorage,
  };
}

export const db = LoomDb({ naming: params.namingParams, data: buildData() });
