/**
 * Named outputs for the `loom-cognito` half of the BYO-everything example
 * (chant#898) — same key set and same reference-existing fallback formulas
 * as the repo's real `src/loom-cognito/outputs.ts`. `cognito.members` is
 * empty (`identity.mode: "reference-existing"` builds no Cognito
 * declarables), so every key here comes from `./params.ts`.
 *
 * `literalOutput(value, name)` rather than `output(literalOutputValue(x), name)`
 * — two nested calls, half of them behind a ternary — for the reason
 * loomster#160 covers: a call inside a ternary branch is rejected by the
 * reducer that folds this file, and one call at the export's own top level is
 * a shape it resolves.
 */

import { literalOutput } from "../../../composites/shared-foundation";
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

export const oCognitoUserPoolId = literalOutput(identity.userPoolId, "oCognitoUserPoolId");
export const oCognitoUserPoolArn = literalOutput(identity.userPoolArn, "oCognitoUserPoolArn");
export const oM2MClientId = literalOutput(identity.m2mClientId, "oM2MClientId");
export const oUserClientId = literalOutput(identity.userClientId, "oUserClientId");
export const oCognitoDomain = literalOutput(identity.domain, "oCognitoDomain");
export const oResourceServerIdentifier = literalOutput(identity.resourceServerIdentifier, "oResourceServerIdentifier");
export const oCognitoIssuer = literalOutput(identity.issuer ?? issuerFallback, "oCognitoIssuer");
export const oCognitoDiscoveryUrl = literalOutput(identity.discoveryUrl ?? discoveryUrlFallback, "oCognitoDiscoveryUrl");
export const oCognitoTokenUrl = literalOutput(identity.tokenUrl ?? tokenUrlFallback, "oCognitoTokenUrl");
