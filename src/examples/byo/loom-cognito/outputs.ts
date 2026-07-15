/**
 * Named outputs for the `loom-cognito` half of the BYO-everything example
 * (chant#898) — same key set and same reference-existing fallback formulas
 * as the repo's real `src/loom-cognito/outputs.ts`. `cognito.members` is
 * empty (`identity.mode: "reference-existing"` builds no Cognito
 * declarables), so every key here comes from `./params.ts`.
 */

import { output } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../../../composites/shared-foundation";
import * as params from "./params";

const identity = params.identity;

// Constructed unconditionally, thrown conditionally — chant's EVL002 forbids
// a resource constructor (any `new Xxx(...)`, including a plain `Error`)
// from appearing inside control flow, same convention every params.ts in
// this repo follows for its own tierFromEnv()-style guards.
const expectedReferenceExistingError = new Error(
  "examples/byo/loom-cognito: expected identity.mode to be reference-existing",
);
if (identity.mode !== "reference-existing") {
  throw expectedReferenceExistingError;
}

const region = params.namingParams.region;
const issuerFallback = `https://cognito-idp.${region}.amazonaws.com/${identity.userPoolId}`;
const discoveryUrlFallback = `${issuerFallback}/.well-known/openid-configuration`;
const tokenUrlFallback = `https://${identity.domain}.auth.${region}.amazoncognito.com/oauth2/token`;

export const oCognitoUserPoolId = output(literalOutputValue(identity.userPoolId), "oCognitoUserPoolId");
export const oCognitoUserPoolArn = identity.userPoolArn
  ? output(literalOutputValue(identity.userPoolArn), "oCognitoUserPoolArn")
  : undefined;
export const oM2MClientId = output(literalOutputValue(identity.m2mClientId), "oM2MClientId");
export const oUserClientId = identity.userClientId
  ? output(literalOutputValue(identity.userClientId), "oUserClientId")
  : undefined;
export const oCognitoDomain = output(literalOutputValue(identity.domain), "oCognitoDomain");
export const oResourceServerIdentifier = output(literalOutputValue(identity.resourceServerIdentifier), "oResourceServerIdentifier");
export const oCognitoIssuer = output(literalOutputValue(identity.issuer ?? issuerFallback), "oCognitoIssuer");
export const oCognitoDiscoveryUrl = output(literalOutputValue(identity.discoveryUrl ?? discoveryUrlFallback), "oCognitoDiscoveryUrl");
export const oCognitoTokenUrl = output(literalOutputValue(identity.tokenUrl ?? tokenUrlFallback), "oCognitoTokenUrl");
