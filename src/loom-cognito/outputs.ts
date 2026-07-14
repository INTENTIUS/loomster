/**
 * Named outputs for the `loom-cognito` stack (chant#888) — UserPool id/ARN,
 * both client ids, the hosted-UI domain, and the OIDC issuer/discovery/token
 * URLs + resource-server identifier #889 (the backend/frontend services) and
 * a future AgentCore Identity RFC 8693 token-exchange step (see
 * `../composites/loom-cognito.ts`'s file header) resolve by the same
 * convention: `stackOutput("loom-cognito", "<key>")`.
 *
 * `identity.mode: "omit"` (chant#898) drops the identity tier entirely — by
 * design, none of these outputs exist for that mode. `"reference-existing"`
 * still exposes every key, threading the given ids/URLs straight through
 * with `literalOutputValue` (no Cognito declarables of its own) — the
 * derived URLs (issuer/discovery/token) fall back to the same formula the
 * provisioned mode uses whenever the caller didn't supply them explicitly.
 */

import { output, Ref, Sub, AWS } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../composites/shared-foundation";
import { cognito } from "./cognito";
import * as params from "./params";
import { loomNaming } from "../lib/naming";

const mode = params.identityMode;
const fullTier = params.namingParams.tier !== "light";
const naming = loomNaming(params.namingParams, "loom-cognito");

// Recomputed independently of the composite (same convention as
// shared-foundation/outputs.ts's `oEcsClusterName`) — `naming.name(...)` is a
// pure function of the naming params, so this yields the identical string
// the composite derived internally when no override was given.
const domainPrefix = params.referenceDomain ?? naming.name("auth", { service: "cognitoDomain" });
const resourceServerIdentifier = params.resourceServerIdentifier ?? naming.name("resource-server");
const referenceIssuerFallback = `https://cognito-idp.${params.namingParams.region}.amazonaws.com/${params.referenceUserPoolId}`;
const referenceDiscoveryUrlFallback = `${referenceIssuerFallback}/.well-known/openid-configuration`;
const referenceTokenUrlFallback = `https://${params.referenceDomain}.auth.${params.namingParams.region}.amazoncognito.com/oauth2/token`;

export const oCognitoUserPoolId = mode === "provision"
  ? output(Ref(cognito.userPool!), "oCognitoUserPoolId")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceUserPoolId as string), "oCognitoUserPoolId")
    : undefined;

export const oCognitoUserPoolArn = mode === "provision"
  ? output(cognito.userPool!.Arn, "oCognitoUserPoolArn")
  : mode === "reference-existing" && params.referenceUserPoolArn
    ? output(literalOutputValue(params.referenceUserPoolArn), "oCognitoUserPoolArn")
    : undefined;

export const oM2MClientId = mode === "provision"
  ? output(cognito.m2mClient!.ClientId, "oM2MClientId")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceM2MClientId as string), "oM2MClientId")
    : undefined;

export const oUserClientId = mode === "provision" && fullTier
  ? output(cognito.userClient!.ClientId, "oUserClientId")
  : mode === "reference-existing" && params.referenceUserClientId
    ? output(literalOutputValue(params.referenceUserClientId), "oUserClientId")
    : undefined;

export const oCognitoDomain = mode === "provision"
  ? output(literalOutputValue(domainPrefix), "oCognitoDomain")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceDomain as string), "oCognitoDomain")
    : undefined;

export const oResourceServerIdentifier = mode === "provision"
  ? output(literalOutputValue(resourceServerIdentifier), "oResourceServerIdentifier")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceResourceServerIdentifier as string), "oResourceServerIdentifier")
    : undefined;

// `Ref(...)`, not the bare declarable — embedding a bare Declarable in a
// `Sub` template throws ("Cannot embed Declarable directly in Sub template.
// Use AttrRef instead."); wrapping it in `Ref()` yields a RefIntrinsic, which
// serializes to `${LogicalId}` exactly like Loom's own `${CognitoUserPool}`.
const userPoolRef = mode === "provision" ? Ref(cognito.userPool!) : undefined;

export const oCognitoIssuer = mode === "provision"
  ? output(Sub`https://cognito-idp.${AWS.Region}.amazonaws.com/${userPoolRef}`, "oCognitoIssuer")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceIssuer ?? referenceIssuerFallback), "oCognitoIssuer")
    : undefined;

export const oCognitoDiscoveryUrl = mode === "provision"
  ? output(
      Sub`https://cognito-idp.${AWS.Region}.amazonaws.com/${userPoolRef}/.well-known/openid-configuration`,
      "oCognitoDiscoveryUrl",
    )
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceDiscoveryUrl ?? referenceDiscoveryUrlFallback), "oCognitoDiscoveryUrl")
    : undefined;

export const oCognitoTokenUrl = mode === "provision"
  ? output(Sub`https://${domainPrefix}.auth.${AWS.Region}.amazoncognito.com/oauth2/token`, "oCognitoTokenUrl")
  : mode === "reference-existing"
    ? output(literalOutputValue(params.referenceTokenUrl ?? referenceTokenUrlFallback), "oCognitoTokenUrl")
    : undefined;
