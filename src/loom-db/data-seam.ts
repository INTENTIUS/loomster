/**
 * `loom-db`'s data-seam builder (loomster#160), lifted out of `./db.ts`.
 *
 * It used to be a file-local `buildData()` called inline inside
 * `LoomDb({ naming, data: buildData() })`. Two separate things made that
 * unfoldable, and both are structural rather than incidental:
 *
 * - a call nested as a VALUE inside a composite's props object literal is
 *   reduced by chant's general reducer (`fold()`), which has no call case at
 *   all — it exists precisely so that folding never executes anything;
 * - a callee defined in the same file cannot be resolved without running that
 *   file, so even at a position chant does resolve calls, a same-file
 *   function is out.
 *
 * Moving it to its own module fixes the second, and `./data.ts` — a file
 * whose only statement is `export const data = buildData(params)` — fixes the
 * first: at a file's own top-level `export const`, chant resolves the callee
 * through that file's `import`s and invokes the real function with
 * statically-folded arguments, exactly as it already does for a composite
 * factory call. `db.ts` then reads `data` as an ordinary cross-file constant.
 *
 * This module holds exported function declarations and therefore never folds
 * itself. That is the correct terminal state for it: it declares no
 * resources, so nothing is lost, and the arbitrary JavaScript stays out of
 * the files that do.
 */

import { Ref, Split, Select, templateTransform, type TemplateTransform } from "@intentius/chant-lexicon-aws";
import type { DataSeam } from "../composites/loom-db";
import { SUBNET_LIST_DELIMITER, toCommaList } from "../composites/shared-foundation";
import type { Tier } from "../lib/naming";

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

/**
 * Assemble the `data` seam from this stack's parameter source. Takes the
 * whole `./params` module rather than fifteen positional arguments: chant
 * resolves a namespace import to the same live exports the defining file
 * produced, so the CFN `Parameter` declarables `Ref(...)`-ed below are the
 * very instances the build collects, not a second copy.
 */
export function buildData(input: typeof import("./params")): DataSeam {
  if (input.dataMode === "omit") {
    return { mode: "omit" };
  }

  if (input.dataMode === "reference-existing") {
    return {
      mode: "reference-existing",
      endpoint: input.referenceEndpoint as string,
      port: input.referencePort,
      dbName: input.dbName,
      credentialsSecretArn: input.referenceCredentialsSecretArn as string,
      connectionSecretArn: input.referenceConnectionSecretArn,
    };
  }

  return {
    mode: "provision",
    network: {
      vpcId: Ref(input.pVpcId) as unknown as string,
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
      subnetIds: explodeTwoSubnetIds(Ref(input.pPrivateSubnetIds) as unknown as string),
      subnetIdsCsv: toCommaList(Split(SUBNET_LIST_DELIMITER, Ref(input.pPrivateSubnetIds))) as unknown as string,
    },
    dbIngress: input.useSourceSecurityGroup
      ? { mode: "security-group", sourceSecurityGroupId: Ref(input.pEcsSecurityGroupId) as unknown as string }
      : { mode: "cidr", cidr: input.allowedCidr },
    dbName: input.dbName,
    dbUsername: input.dbUsername,
    dbPassword: input.dbPassword as string,
    dbInstanceClass: input.dbInstanceClass,
    dbAllocatedStorage: input.dbAllocatedStorage,
  };
}

/**
 * The production-ha rotation schedule uses a Secrets Manager
 * HostedRotationLambda, which CloudFormation only accepts when the template
 * declares the `AWS::SecretsManager-2020-07-23` transform (loomster#129). The
 * composite builds that rotation exactly when the tier is production-ha and
 * the data tier is provisioned, so the transform is declared under the same
 * condition, and `undefined` otherwise (chant discovery tolerates a
 * conditional `undefined` export, like the tier-gated outputs in
 * `./outputs.ts`).
 *
 * A function rather than a ternary in `./db.ts` so the decision folds for
 * every tier, not just the ones whose branch happens to be call-free: chant's
 * reducer evaluates a ternary's condition and reduces only the taken branch,
 * so a `templateTransform(...)` call written inline would fold on light and
 * fall the file back to run on production-ha.
 */
export function rotationTransformFor(tier: Tier, dataMode: string): TemplateTransform | undefined {
  if (tier !== "production-ha" || dataMode !== "provision") return undefined;
  return templateTransform("AWS::SecretsManager-2020-07-23");
}
