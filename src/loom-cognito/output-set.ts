/**
 * `loom-cognito`'s named-output set (loomster#160) — the exact logic
 * `./outputs.ts` used to spell inline, moved behind one call, for the reasons
 * `../loom-db/output-set.ts`'s header gives: chant's reducer reduces only a
 * ternary's taken branch and has no call case, so a `literalOutputValue(...)`
 * arm made the file fold or not depending on which `identity.mode` the build
 * happened to be in. A call at a file's own top-level `export const`,
 * including the destructured form, is resolved through the file's imports and
 * invoked for real.
 *
 * `identity.mode: "omit"` (chant#898) drops the identity tier entirely — by
 * design, none of these outputs exist for that mode. `"reference-existing"`
 * still exposes every key, threading the given ids/URLs straight through with
 * `literalOutputValue` (no Cognito declarables of its own) — the derived URLs
 * (issuer/discovery/token) fall back to the same formula the provisioned mode
 * uses whenever the caller didn't supply them explicitly.
 */

import { output, Ref, Sub, AWS, type LexiconOutput } from "@intentius/chant-lexicon-aws";
import type { CompositeInstance } from "@intentius/chant";
import { literalOutputValue } from "../composites/shared-foundation";
import type { LoomCognitoResult } from "../composites/loom-cognito";
import { loomNaming } from "../lib/naming";

export interface LoomCognitoOutputs {
  oCognitoUserPoolId: LexiconOutput | undefined;
  oCognitoUserPoolArn: LexiconOutput | undefined;
  oM2MClientId: LexiconOutput | undefined;
  oUserClientId: LexiconOutput | undefined;
  oCognitoDomain: LexiconOutput | undefined;
  oResourceServerIdentifier: LexiconOutput | undefined;
  oCognitoIssuer: LexiconOutput | undefined;
  oCognitoDiscoveryUrl: LexiconOutput | undefined;
  oCognitoTokenUrl: LexiconOutput | undefined;
}

/**
 * UserPool id/ARN, both client ids, the hosted-UI domain, and the OIDC
 * issuer/discovery/token URLs + resource-server identifier, so #889 (the
 * backend/frontend services) and a future AgentCore Identity RFC 8693
 * token-exchange step (see `../composites/loom-cognito.ts`'s file header)
 * resolve by the same convention: `stackOutput("loom-cognito", "<key>")`.
 */
export function loomCognitoOutputs(
  cognito: CompositeInstance<LoomCognitoResult> & LoomCognitoResult,
  input: typeof import("./params"),
): LoomCognitoOutputs {
  const mode = input.identityMode;
  const fullTier = input.namingParams.tier !== "light";
  const provisioned = mode === "provision";
  const referenced = mode === "reference-existing";
  const naming = loomNaming(input.namingParams, "loom-cognito");

  // Recomputed independently of the composite (same convention as
  // shared-foundation's `oEcsClusterName`) — `naming.name(...)` is a pure
  // function of the naming params, so this yields the identical string the
  // composite derived internally when no override was given.
  const domainPrefix = input.referenceDomain ?? naming.name("auth", { service: "cognitoDomain" });
  const resourceServerIdentifier = input.resourceServerIdentifier ?? naming.name("resource-server");
  const referenceIssuerFallback = `https://cognito-idp.${input.namingParams.region}.amazonaws.com/${input.referenceUserPoolId}`;
  const referenceDiscoveryUrlFallback = `${referenceIssuerFallback}/.well-known/openid-configuration`;
  const referenceTokenUrlFallback = `https://${input.referenceDomain}.auth.${input.namingParams.region}.amazoncognito.com/oauth2/token`;

  // `Ref(...)`, not the bare declarable — embedding a bare Declarable in a
  // `Sub` template throws ("Cannot embed Declarable directly in Sub template.
  // Use AttrRef instead."); wrapping it in `Ref()` yields a RefIntrinsic, which
  // serializes to `${LogicalId}` exactly like Loom's own `${CognitoUserPool}`.
  const userPoolRef = provisioned ? Ref(cognito.userPool!) : undefined;

  return {
    oCognitoUserPoolId: provisioned
      ? output(Ref(cognito.userPool!), "oCognitoUserPoolId")
      : referenced
        ? output(literalOutputValue(input.referenceUserPoolId as string), "oCognitoUserPoolId")
        : undefined,

    oCognitoUserPoolArn: provisioned
      ? output(cognito.userPool!.Arn, "oCognitoUserPoolArn")
      : referenced && input.referenceUserPoolArn
        ? output(literalOutputValue(input.referenceUserPoolArn), "oCognitoUserPoolArn")
        : undefined,

    oM2MClientId: provisioned
      ? output(cognito.m2mClient!.ClientId, "oM2MClientId")
      : referenced
        ? output(literalOutputValue(input.referenceM2MClientId as string), "oM2MClientId")
        : undefined,

    oUserClientId: provisioned && fullTier
      ? output(cognito.userClient!.ClientId, "oUserClientId")
      : referenced && input.referenceUserClientId
        ? output(literalOutputValue(input.referenceUserClientId), "oUserClientId")
        : undefined,

    oCognitoDomain: provisioned
      ? output(literalOutputValue(domainPrefix), "oCognitoDomain")
      : referenced
        ? output(literalOutputValue(input.referenceDomain as string), "oCognitoDomain")
        : undefined,

    oResourceServerIdentifier: provisioned
      ? output(literalOutputValue(resourceServerIdentifier), "oResourceServerIdentifier")
      : referenced
        ? output(literalOutputValue(input.referenceResourceServerIdentifier as string), "oResourceServerIdentifier")
        : undefined,

    oCognitoIssuer: provisioned
      ? output(Sub`https://cognito-idp.${AWS.Region}.amazonaws.com/${userPoolRef}`, "oCognitoIssuer")
      : referenced
        ? output(literalOutputValue(input.referenceIssuer ?? referenceIssuerFallback), "oCognitoIssuer")
        : undefined,

    oCognitoDiscoveryUrl: provisioned
      ? output(
          Sub`https://cognito-idp.${AWS.Region}.amazonaws.com/${userPoolRef}/.well-known/openid-configuration`,
          "oCognitoDiscoveryUrl",
        )
      : referenced
        ? output(literalOutputValue(input.referenceDiscoveryUrl ?? referenceDiscoveryUrlFallback), "oCognitoDiscoveryUrl")
        : undefined,

    oCognitoTokenUrl: provisioned
      ? output(Sub`https://${domainPrefix}.auth.${AWS.Region}.amazoncognito.com/oauth2/token`, "oCognitoTokenUrl")
      : referenced
        ? output(literalOutputValue(input.referenceTokenUrl ?? referenceTokenUrlFallback), "oCognitoTokenUrl")
        : undefined,
  };
}
