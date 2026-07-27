/**
 * `loom-db`'s named-output set (loomster#160) — the exact logic `./outputs.ts`
 * used to spell inline, moved behind one call.
 *
 * Why it had to move: chant's reducer evaluates a ternary's condition and
 * reduces only the taken branch, and it has no call case at all. Every output
 * here is "resource attribute, or the reference-existing literal, or nothing",
 * and the literal arm is a `literalOutputValue(...)` call — so the file folded
 * or didn't depending on which mode the build happened to be in, which is not
 * a property worth having. Nor can the arms be hoisted into constants: the
 * reducer follows an identifier straight back to the same call node.
 *
 * A call at a file's own top-level `export const` — including the
 * destructured form `export const { a, b } = f(...)`, a shape chant folds
 * specifically because composites use it — is resolved through the file's own
 * imports and invoked for real with folded arguments. So the branching lives
 * in an ordinary function, and `./outputs.ts` stays a plain list of what this
 * stack publishes.
 *
 * `data.mode: "omit"` (chant#898) drops the data tier entirely — by design,
 * none of these outputs exist for that mode; each is `undefined`, which chant
 * discovery tolerates. `"reference-existing"` still exposes every key,
 * threading the given endpoint/secret ARNs straight through with
 * `literalOutputValue` (no RDS declarables of its own).
 */

import { output, Ref, type LexiconOutput } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../composites/shared-foundation";
import type { LoomDbResult } from "../composites/loom-db";
import type { CompositeInstance } from "@intentius/chant";

export interface LoomDbOutputs {
  oRdsEndpoint: LexiconOutput | undefined;
  oRdsPort: LexiconOutput | undefined;
  oRdsDbName: LexiconOutput | undefined;
  oProxyEndpoint: LexiconOutput | undefined;
  oConnectEndpoint: LexiconOutput | undefined;
  oSecretsKmsKeyArn: LexiconOutput | undefined;
  oRdsSecretArn: LexiconOutput | undefined;
  oRdsCredentialsSecretArn: LexiconOutput | undefined;
}

/**
 * The key set Loom's own `backend/iac/rds.yaml` exposes, so #889 (the backend
 * ECS service) resolves them by the same convention:
 * `stackOutput("loom-db", "<key>")`. The backend reads `oConnectEndpoint` and
 * `oRdsCredentialsSecretArn`.
 */
export function loomDbOutputs(db: CompositeInstance<LoomDbResult> & LoomDbResult, input: typeof import("./params")): LoomDbOutputs {
  const mode = input.dataMode;
  const fullTier = input.namingParams.tier !== "light";
  const provisioned = mode === "provision";
  const referenced = mode === "reference-existing";

  return {
    oRdsEndpoint: provisioned
      ? output(db.rdsInstance!.Endpoint_Address, "oRdsEndpoint")
      : referenced
        ? output(literalOutputValue(input.referenceEndpoint as string), "oRdsEndpoint")
        : undefined,

    oRdsPort: provisioned
      ? output(db.rdsInstance!.Endpoint_Port, "oRdsPort")
      : referenced
        ? output(literalOutputValue(`${input.referencePort ?? 5432}`), "oRdsPort")
        : undefined,

    oRdsDbName: mode !== "omit" ? output(literalOutputValue(input.dbName ?? "loom"), "oRdsDbName") : undefined,

    // Present only when a proxy was actually built (provision +
    // production/production-ha) — matches Loom's own `oProxyEndpoint` output,
    // which only exists when `pEnableProxy` is true.
    oProxyEndpoint: provisioned && fullTier ? output(db.rdsProxy!.Endpoint, "oProxyEndpoint") : undefined,

    oConnectEndpoint: provisioned
      ? output(fullTier ? db.rdsProxy!.Endpoint : db.rdsInstance!.Endpoint_Address, "oConnectEndpoint")
      : referenced
        ? output(literalOutputValue(input.referenceEndpoint as string), "oConnectEndpoint")
        : undefined,

    oSecretsKmsKeyArn: provisioned ? output(db.secretsKmsKey!.Arn, "oSecretsKmsKeyArn") : undefined,

    oRdsSecretArn: provisioned
      ? output(Ref(db.rdsConnectionSecret!), "oRdsSecretArn")
      : referenced && input.referenceConnectionSecretArn
        ? output(literalOutputValue(input.referenceConnectionSecretArn), "oRdsSecretArn")
        : undefined,

    oRdsCredentialsSecretArn: provisioned
      ? output(Ref(db.rdsCredentialsSecret!), "oRdsCredentialsSecretArn")
      : referenced
        ? output(literalOutputValue(input.referenceCredentialsSecretArn as string), "oRdsCredentialsSecretArn")
        : undefined,
  };
}
