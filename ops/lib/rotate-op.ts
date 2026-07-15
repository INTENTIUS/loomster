/**
 * Rotation Op factory (chant#905) — Cognito M2M app-client, RDS master
 * credentials, and (custom-domain tiers) the ALB's ACM certificate. Shared by
 * `../loom-rotate-production.op.ts` / `../loom-rotate-production-ha.op.ts`.
 *
 * `light` gets no rotation Op at all: it has no RDS Proxy, no rotation Lambda,
 * and no custom domain/ACM certificate (`../../src/composites/shared-foundation.ts`'s
 * ACM/Route53 seam is gated to `production`/`production-ha`) — there is
 * nothing tier-appropriate left to rotate on a scratch/dev-tier deployment.
 *
 * Every phase here is gated (chant#905: "Gate where a rotation is disruptive")
 * — unlike the upgrade Op, rotation has no tier where the disruptive half runs
 * unattended:
 *   - Cognito: create the replacement client (safe, additive) -> **Approve**
 *     -> delete the outgoing client (invalidates its secret for anyone not yet
 *     switched over).
 *   - RDS: rotating the live credential (native trigger on `production-ha`,
 *     manual password swap on `production`) briefly affects in-flight
 *     connections either way -> gated on both tiers.
 *   - ACM (custom-domain tiers only): request + validate the new cert (safe)
 *     -> **Approve** -> swap the listener onto it (disruptive: wrong cert
 *     breaks TLS for every client).
 */

import { Op, phase, gate, shell } from "@intentius/chant-lexicon-temporal";
import { OpResource } from "@intentius/chant/op";
import type { LoomNamingParams } from "../../src/lib/naming";
import { stackRefs } from "./stack-refs";
import {
  cognitoCreateReplacementClientScript,
  cognitoDeleteOldClientScript,
  rdsRotateNativeScript,
  rdsRotateManualScript,
  acmRequestScript,
  acmSwapListenerScript,
} from "./rotation";

export interface LoomRotateOpConfig {
  naming: LoomNamingParams;
}

function dbUsername(): string {
  return process.env.LOOM_DB_USERNAME ?? "loom";
}

function dbName(): string {
  return process.env.LOOM_DB_NAME ?? "loom";
}

export function buildLoomRotateOp(config: LoomRotateOpConfig): InstanceType<typeof OpResource> {
  const { naming } = config;
  const tier = naming.tier;
  const refs = stackRefs(naming);
  const opName = `loom-rotate-${tier}`;
  const domainName = process.env.LOOM_DOMAIN_NAME;

  const rdsRotateScript =
    tier === "production-ha"
      ? rdsRotateNativeScript(refs.credentialsSecretName)
      : rdsRotateManualScript({
          dbInstanceIdentifier: refs.dbInstanceIdentifier,
          credentialsSecretName: refs.credentialsSecretName,
          connectionSecretName: refs.connectionSecretName,
          dbUsername: dbUsername(),
          dbName: dbName(),
          rdsProxyName: refs.rdsProxyName,
        });

  const phases = [
    phase("PrepareCognitoRotation", [
      shell(
        cognitoCreateReplacementClientScript({
          userPoolName: refs.cognitoUserPoolName,
          oldClientName: refs.cognitoM2mClientName,
          replacementSecretName: refs.cognitoM2mReplacementSecretName,
        }),
        { profile: "longInfra" },
      ),
    ]),
    phase("RotateRdsCredential", [shell(rdsRotateScript, { profile: "longInfra" })]),
  ];

  if (domainName) {
    phases.push(phase("RequestCertificate", [shell(acmRequestScript({ domainName }), { profile: "longInfra" })]));
  }

  phases.push(
    phase("Approve", [
      gate(`approve-${opName}`, {
        timeout: "24h",
        description: `Approve completing credential rotation for ${tier} (env=${naming.env}): deletes the outgoing Cognito client${domainName ? " and swaps the ALB listener's certificate" : ""} — confirm downstream consumers switched over first.`,
      }),
    ]),
  );

  // Hoisted to a const (chant's EVL004 requires a spread source to be a const
  // identifier/literal, never an inline ternary).
  const acmSwapSteps = domainName
    ? [shell(acmSwapListenerScript({ albName: refs.albName, domainName }), { profile: "longInfra" })]
    : [];

  phases.push(
    phase("CompleteRotation", [
      shell(cognitoDeleteOldClientScript({ userPoolName: refs.cognitoUserPoolName, oldClientName: refs.cognitoM2mClientName })),
      ...acmSwapSteps,
    ]),
  );

  return Op({
    name: opName,
    overview: `Rotate Cognito/RDS credentials${domainName ? " + ACM certificate" : ""} for the Loom "${tier}" deployment (env=${naming.env})`,
    taskQueue: "loom-lifecycle",
    searchAttributes: { Tier: tier, Env: naming.env },
    phases,
  });
}
