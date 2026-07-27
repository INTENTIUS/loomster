/**
 * shared-foundation's adoption-seam resolvers (chant#117/#120), relocated out
 * of `./params.ts` (chant#1064 migration): an EXPORTED function declaration
 * anywhere in a file makes the whole file un-foldable (`chant build --fold`
 * falls it back to run) — these are pure, unit-tested (`dns-seams.test.ts`,
 * `foundation-seams.test.ts`) and still need to stay importable there, so
 * they live in their own module instead. `params.ts` imports them and calls
 * each with build-time-parameter values instead of `process.env` reads —
 * chant's fold engine resolves a call through the file's own `import`s (the
 * same mechanism a composite factory call already uses), so
 * `resolveRoute53(params.hostedZoneId, params.route53Mode)` folds to a real
 * value with zero module execution, exactly like the values around it.
 */

import type { Route53Seam, AcmSeam, KmsSeam, EcrSeam, AgentRoleSeam } from "../composites/shared-foundation";

/**
 * Route53 seam (#117). The common adoption case is referencing an existing zone
 * — most teams already own the parent domain — so a hosted zone id points at
 * one (loomster adds the ALB alias record, creates no zone). `mode: "omit"`
 * drops DNS entirely; `"provision"` forces a new zone. Unset → the composite's
 * tier default (provision on production/production-ha, unused on light).
 */
export function resolveRoute53(hostedZoneId: string | undefined, mode: string | undefined): Route53Seam | undefined {
  if (hostedZoneId) return { mode: "reference-existing", hostedZoneId };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}

/**
 * ACM seam (#117). A certificate ARN references an existing, already
 * DNS-validated certificate (no cert provisioned, no validation wait);
 * `mode: "omit"` drops HTTPS; `"provision"` forces a new cert. Unset → the
 * composite's tier default.
 */
export function resolveAcm(certificateArn: string | undefined, mode: string | undefined): AcmSeam | undefined {
  if (certificateArn) return { mode: "reference-existing", certificateArn };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}

/**
 * KMS seam (#120). A KMS key ARN references an existing key (used to encrypt
 * the ECR repos); `mode: "omit"` drops it. Unset → the composite's provision
 * default. Same shape as the DNS seams above.
 */
export function resolveKms(kmsKeyArn: string | undefined, mode: string | undefined): KmsSeam | undefined {
  if (kmsKeyArn) return { mode: "reference-existing", kmsKeyArn };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}

/**
 * ECR seam (#120). Referencing existing repos needs all four ids
 * (frontend/backend repository URI + ARN); a partial set is ignored rather
 * than half-wired. `mode: "omit"` drops the repos. Unset → the composite's
 * provision default.
 */
export function resolveEcr(
  frontendUri: string | undefined,
  frontendArn: string | undefined,
  backendUri: string | undefined,
  backendArn: string | undefined,
  mode: string | undefined,
): EcrSeam | undefined {
  if (frontendUri && frontendArn && backendUri && backendArn) {
    return { mode: "reference-existing", frontendRepositoryUri: frontendUri, frontendRepositoryArn: frontendArn, backendRepositoryUri: backendUri, backendRepositoryArn: backendArn };
  }
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}

/**
 * Agent execution role seam (#120). An agent role ARN references the
 * least-privilege AgentCore role a security team already built; `mode:
 * "omit"` drops it. Unset → the composite's provision default.
 */
export function resolveAgentRole(agentRoleArn: string | undefined, mode: string | undefined): AgentRoleSeam | undefined {
  if (agentRoleArn) return { mode: "reference-existing", agentRoleArn };
  if (mode === "omit") return { mode: "omit" };
  if (mode === "provision") return { mode: "provision" };
  return undefined;
}
