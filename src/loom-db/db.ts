/**
 * The deployable `loom-db` stack (chant#887) — RDS Postgres, subnet group,
 * KMS, the two Secrets Manager secrets, and (production/production-ha) the
 * RDS Proxy + secret rotation. One `LoomDb(...)` call; `data.mode` defaults
 * to "provision" (see ../composites/loom-db.ts). Assembles the `data` seam
 * from `./params.ts` — this file has zero resource constructors of its own,
 * so none of chant's EVL rules apply to it.
 */

import { Ref, Split, Select } from "@intentius/chant-lexicon-aws";
import { LoomDb, type DataSeam } from "../composites/loom-db";
import { SUBNET_LIST_DELIMITER, toCommaList } from "../composites/shared-foundation";
import * as params from "./params";

/**
 * Explode a `SUBNET_LIST_DELIMITER`-joined `Ref` into a genuine 2-element
 * array — `[Fn::Select(0, Fn::Split(...)), Fn::Select(1, Fn::Split(...))]` —
 * rather than handing `RDSDBSubnetGroup.SubnetIds`/`DBProxy.VpcSubnetIds`
 * (`../composites/loom-db.ts`) a single `Fn::Split` call standing in for the
 * whole list. Verified live: Floci's RDS emulation resolves a *literal*
 * `SubnetIds` array containing 2 intrinsics correctly, but doesn't evaluate
 * `Fn::Split` at all when it's the *entire* `SubnetIds` value ("The request
 * must contain the parameter SubnetIds") — the same value shape (`Fn::Split`
 * used directly as an ECS service's `Subnets`) resolves fine there, so this
 * is specifically an RDS-family gap, not a general one (chant#928/
 * loomster#35). shared-foundation's provisioned/reference-existing network
 * is always exactly 2 subnets (2 AZs, matching this composite's own "needs
 * at least 2 subnets" contract), so a fixed 2-element explosion is exact,
 * not an approximation.
 */
function explodeTwoSubnetIds(joinedRef: string): string[] {
  return [
    Select(0, Split(SUBNET_LIST_DELIMITER, joinedRef)) as unknown as string,
    Select(1, Split(SUBNET_LIST_DELIMITER, joinedRef)) as unknown as string,
  ];
}

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
    network: {
      vpcId: Ref(params.pVpcId) as unknown as string,
      // `pPrivateSubnetIds`'s Ref is shared-foundation's `oPrivateSubnetIds`
      // output, joined with `SUBNET_LIST_DELIMITER` (":", not ",") — see
      // that constant's docstring for why. `explodeTwoSubnetIds` turns it
      // back into a genuine 2-element array (see that function's own
      // docstring for why not a single `Split(...)` standing in for the
      // list). `subnetIdsCsv` needs an actual comma-separated string
      // (RotationSchedule_HostedRotationLambda's own real AWS field
      // contract, unrelated to our own wire delimiter) — re-join with ","
      // after splitting, a template-level Fn::Split/Fn::Join, not a JS
      // `.join(",")` on a value `buildDbCore` can't see until deploy time
      // (see ../composites/loom-db.ts).
      subnetIds: explodeTwoSubnetIds(Ref(params.pPrivateSubnetIds) as unknown as string),
      subnetIdsCsv: toCommaList(Split(SUBNET_LIST_DELIMITER, Ref(params.pPrivateSubnetIds))) as unknown as string,
    },
    dbIngress: params.useSourceSecurityGroup
      ? { mode: "security-group", sourceSecurityGroupId: Ref(params.pEcsSecurityGroupId) as unknown as string }
      : { mode: "cidr", cidr: params.allowedCidr },
    dbName: params.dbName,
    dbUsername: params.dbUsername,
    dbPassword: params.dbPassword as string,
    dbInstanceClass: params.dbInstanceClass,
    dbAllocatedStorage: params.dbAllocatedStorage,
  };
}

export const db = LoomDb({ naming: params.namingParams, data: buildData() });
