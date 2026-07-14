/**
 * Named outputs for the `loom-db` stack (chant#887) — the exact key set
 * Loom's own `backend/iac/rds.yaml` exposes, so #889 (the backend ECS
 * service) resolves them by the same convention:
 * `stackOutput("loom-db", "<key>")`. The backend reads `oConnectEndpoint`
 * and `oRdsCredentialsSecretArn`.
 *
 * `data.mode: "omit"` (chant#898) drops the data tier entirely — by design,
 * none of these outputs exist for that mode. `"reference-existing"` still
 * exposes every key, threading the given endpoint/secret ARNs straight
 * through with `literalOutputValue` (no RDS declarables of its own).
 */

import { output, Ref } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../composites/shared-foundation";
import { db } from "./db";
import * as params from "./params";

const mode = params.dataMode;
const fullTier = params.namingParams.tier !== "light";

export const oRdsEndpoint = mode === "provision"
  ? output(db.rdsInstance!.Endpoint_Address, "oRdsEndpoint")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceEndpoint as string), "oRdsEndpoint")
    : undefined;

export const oRdsPort = mode === "provision"
  ? output(db.rdsInstance!.Endpoint_Port, "oRdsPort")
  : mode === "reference-existing"
    ? output(literalOutputValue(`${params.referencePort ?? 5432}`), "oRdsPort")
    : undefined;

export const oRdsDbName = mode !== "omit"
  ? output(literalOutputValue(params.dbName ?? "loom"), "oRdsDbName")
  : undefined;

// Present only when a proxy was actually built (provision + production/production-ha) — matches
// Loom's own `oProxyEndpoint` output, which only exists when `pEnableProxy` is true.
export const oProxyEndpoint = mode === "provision" && fullTier
  ? output(db.rdsProxy!.Endpoint, "oProxyEndpoint")
  : undefined;

export const oConnectEndpoint = mode === "provision"
  ? output(fullTier ? db.rdsProxy!.Endpoint : db.rdsInstance!.Endpoint_Address, "oConnectEndpoint")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceEndpoint as string), "oConnectEndpoint")
    : undefined;

export const oSecretsKmsKeyArn = mode === "provision"
  ? output(db.secretsKmsKey!.Arn, "oSecretsKmsKeyArn")
  : undefined;

export const oRdsSecretArn = mode === "provision"
  ? output(Ref(db.rdsConnectionSecret!), "oRdsSecretArn")
  : mode === "reference-existing" && params.referenceConnectionSecretArn
    ? output(literalOutputValue(params.referenceConnectionSecretArn), "oRdsSecretArn")
    : undefined;

export const oRdsCredentialsSecretArn = mode === "provision"
  ? output(Ref(db.rdsCredentialsSecret!), "oRdsCredentialsSecretArn")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceCredentialsSecretArn as string), "oRdsCredentialsSecretArn")
    : undefined;
