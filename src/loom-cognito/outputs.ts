/**
 * Named outputs for the `loom-cognito` stack (chant#888) — UserPool id/ARN,
 * both client ids, the hosted-UI domain, and the OIDC issuer/discovery/token
 * URLs + resource-server identifier, so #889 (the backend/frontend services)
 * and a future AgentCore Identity RFC 8693 token-exchange step resolve by the
 * same convention: `stackOutput("loom-cognito", "<key>")`.
 *
 * Which of these actually exist depends on `identity.mode` (chant#898) and
 * the tier — `loomCognitoOutputs` in `./output-set.ts` holds that decision,
 * and its header explains why it is a function call here rather than the
 * ternaries this file used to spell inline (loomster#160).
 */

import { cognito } from "./cognito";
import * as params from "./params";
import { loomCognitoOutputs } from "./output-set";

export const {
  oCognitoUserPoolId,
  oCognitoUserPoolArn,
  oM2MClientId,
  oUserClientId,
  oCognitoDomain,
  oResourceServerIdentifier,
  oCognitoIssuer,
  oCognitoDiscoveryUrl,
  oCognitoTokenUrl,
} = loomCognitoOutputs(cognito, params);
