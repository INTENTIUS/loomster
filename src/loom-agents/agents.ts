/**
 * The deployable `loom-agents` stack (chant#893) — the Bedrock AgentCore
 * agent set: a low-code Strands agent on every tier, plus a no-code
 * AgentCore-harness agent on production/production-ha. One `LoomAgents(...)`
 * call; every cross-stack input is `Ref(...)`-wrapped from `./params.ts`'s
 * CFN `Parameter`s, resolved at deploy time by
 * `../components/loom-agents.component.ts`'s `cfn-deploy` step's `inputs`
 * map — this file has zero resource constructors of its own, so none of
 * chant's EVL rules apply to it (same convention `../loom-backend/backend.ts`/
 * `../loom-db/db.ts` use).
 */

import { Ref, Split } from "@intentius/chant-lexicon-aws";
import { LoomAgents } from "../composites/loom-agents";
import { SUBNET_LIST_DELIMITER } from "../composites/shared-foundation";
import * as params from "./params";

export const agents = LoomAgents({
  naming: params.namingParams,

  artifactBucket: Ref(params.pArtifactBucket) as unknown as string,
  ecsSecurityGroupId: Ref(params.pEcsSecurityGroupId) as unknown as string,
  backendBaseUrl: Ref(params.pDomainName) as unknown as string,
  cognitoTokenUrl: Ref(params.pCognitoTokenUrl) as unknown as string,
  cognitoDiscoveryUrl: Ref(params.pCognitoDiscoveryUrl) as unknown as string,

  assistantCodePrefix: Ref(params.pAssistantCodePrefix) as unknown as string,
  // Pass the harness image Ref ONLY when a real image was supplied at build time
  // (LOOM_HARNESS_AGENT_IMAGE_URI). The prop is always a CFN `Ref`, so the
  // composite can't tell "supplied" from "empty" — this env gate is what makes
  // the composite emit no harness Runtime by default (loomster#128).
  harnessImageUri: process.env.LOOM_HARNESS_AGENT_IMAGE_URI
    ? (Ref(params.pHarnessAgentImageUri) as unknown as string)
    : undefined,

  privateSubnetIds: Split(SUBNET_LIST_DELIMITER, Ref(params.pPrivateSubnetIds)) as unknown as string[],

  bedrockModelArns: params.bedrockModelArns,
  memoryEventExpiryDays: params.memoryEventExpiryDays,
});
