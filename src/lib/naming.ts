/**
 * Loom naming + tagging helper (chant#897).
 *
 * The shared parameter source every Loom composite conforms to. One function
 * derives both the physical resource names and the cost-allocation tags
 * (chant#896) from the same params — no second copy of the naming logic, no
 * hardcoded names/ARNs/regions/account ids anywhere in a composite.
 *
 * Naming key (segment order, fixed): `{project}-{env}-{instance}-{component}-{resource}`.
 * The `instance` segment (tenant/boundary) is what keeps N Loom instances
 * collision-free in one account or across many (chant#890, #895, #898).
 *
 * Usage:
 * ```ts
 * import { loomNaming } from "../lib/naming";
 *
 * const naming = loomNaming(
 *   { project: "loom", env: "prod", instance: "a", tier: "production", region: "us-east-1", accountId, owner: "platform" },
 *   "loom-db",
 * );
 *
 * naming.name("instance", { service: "rdsInstance" }); // "loom-prod-a-loom-db-instance"
 * naming.tags(); // { component: "loom-db", tier: "production", env: "prod", owner: "platform", instance: "a" }
 * ```
 *
 * See `../../docs/naming.md` for the full convention, the per-service
 * length/char limits below, and the uniqueness strategy.
 */

import { createHash } from "node:crypto";

/** Loom's three deployment tiers (chant#890) — three is the ceiling. */
export type Tier = "light" | "production" | "production-ha";

export interface LoomNamingParams {
  /** Project segment, e.g. "loom". Identifies the deployment family. */
  project: string;
  /** Environment segment, e.g. "dev", "staging", "prod". */
  env: string;
  /**
   * Instance/tenant/boundary segment — orthogonal to `tier` (chant#890).
   * Mandatory: this is the dimension that keeps N Loom instances
   * collision-free in one AWS account or spread across many.
   */
  instance: string;
  /** Tier profile (chant#890). Carried through to `tags()`; does not affect naming. */
  tier: Tier;
  /**
   * AWS region. Feeds the uniqueness suffix on globally/regionally-unique
   * resources (S3 bucket names, Cognito domain prefixes).
   */
  region: string;
  /**
   * AWS account id, when known. Strengthens the uniqueness suffix on
   * globally-unique resources. Optional — some composites are authored
   * account-agnostic (reference-existing network/IAM, chant#898).
   */
  accountId?: string;
  /** Cost-allocation owner tag — the team/individual accountable for spend. */
  owner: string;
}

/**
 * AWS services with a physical-name constraint this helper knows how to
 * satisfy. `"default"` applies no length limit and no uniqueness suffix.
 */
export type ServiceKind =
  | "default"
  | "alb"
  | "targetGroup"
  | "s3Bucket"
  | "rdsInstance"
  | "rdsProxy"
  | "cognitoDomain"
  | "ecrRepo";

export interface NameOptions {
  /** Which per-service constraint to apply. Default: `"default"` (no limit). */
  service?: ServiceKind;
}

export interface LoomNaming {
  /** Derive the physical name for one resource within this component. */
  name(resource: string, opts?: NameOptions): string;
  /** Derive the cost-allocation tag set (chant#896), merging in any extra tags. */
  tags(extra?: Record<string, string>): Record<string, string>;
}

interface ServiceLimit {
  /** Hard character ceiling for the physical name. */
  maxLength?: number;
  /**
   * True for resources whose physical name must be unique beyond this
   * account/region pair (S3: globally across all AWS accounts; Cognito
   * domain: unique per AWS Region). A deterministic account/region-derived
   * suffix is appended so two accounts (or regions) never collide even with
   * identical project/env/instance/component/resource segments.
   */
  globallyUnique?: boolean;
  /** True when the service requires the name to start with a letter. */
  startAlpha?: boolean;
  /** Prefixes AWS reserves and rejects at the start of the name. */
  reservedPrefixes?: string[];
}

const HASH_LEN = 6;

/**
 * Per-service AWS physical-name constraints (chant#897 implementation notes).
 * Sources: ELBv2 (ALB/target group names, 32 chars), S3 (bucket names,
 * 3-63 chars, globally unique), RDS (DB instance identifier + DB Proxy name,
 * <=63 chars, must start with a letter), Cognito (user pool domain prefix,
 * <=63 chars, unique per Region, reserved "aws"/"amazon"/"cognito" prefixes),
 * ECR (repository name, <=256 chars).
 */
const SERVICE_LIMITS: Record<ServiceKind, ServiceLimit> = {
  default: {},
  alb: { maxLength: 32 },
  targetGroup: { maxLength: 32 },
  s3Bucket: { maxLength: 63, globallyUnique: true },
  rdsInstance: { maxLength: 63, startAlpha: true },
  rdsProxy: { maxLength: 63, startAlpha: true },
  cognitoDomain: { maxLength: 63, globallyUnique: true, reservedPrefixes: ["aws", "amazon", "cognito"] },
  ecrRepo: { maxLength: 256 },
};

function shortHash(input: string, len = HASH_LEN): string {
  return createHash("sha1").update(input).digest("hex").slice(0, len);
}

/** Lowercase, replace anything outside `[a-z0-9-]` with `-`, collapse/trim hyphens. */
function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Truncate to `maxLength`, replacing the overflow tail with a short hash of
 * the full (pre-truncation) string — so two different inputs that happen to
 * share a long common prefix still land on distinct truncated names.
 */
function truncateWithHash(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const hash = shortHash(value);
  const keep = Math.max(maxLength - hash.length - 1, 1);
  return `${value.slice(0, keep)}-${hash}`.slice(0, maxLength);
}

/** Deterministic account/region-derived suffix for globally-unique resources. */
function uniqueSuffix(params: LoomNamingParams): string {
  return shortHash(`${params.accountId ?? "no-account"}:${params.region}`);
}

/**
 * Build the naming + tagging helper for one component within a Loom
 * deployment. Call once per component (composites typically call this at
 * the top of the file) and use the returned `name()`/`tags()` for every
 * resource it declares.
 */
export function loomNaming(params: LoomNamingParams, component: string): LoomNaming {
  const sanitizedComponent = sanitize(component);
  const base = [params.project, params.env, params.instance, sanitizedComponent]
    .map(sanitize)
    .filter(Boolean)
    .join("-");

  return {
    name(resource: string, opts?: NameOptions): string {
      const limits = SERVICE_LIMITS[opts?.service ?? "default"];

      let value = sanitize(`${base}-${resource}`);

      if (limits.globallyUnique) {
        value = `${value}-${uniqueSuffix(params)}`;
      }

      if (limits.reservedPrefixes?.some((prefix) => value.startsWith(prefix))) {
        value = `x-${value}`;
      }

      if (limits.startAlpha && !/^[a-z]/.test(value)) {
        value = `x${value}`;
      }

      if (limits.maxLength) {
        value = truncateWithHash(value, limits.maxLength);
      }

      return value;
    },

    tags(extra?: Record<string, string>): Record<string, string> {
      return {
        component: sanitizedComponent,
        tier: params.tier,
        env: params.env,
        owner: params.owner,
        instance: params.instance,
        ...extra,
      };
    },
  };
}

/**
 * Stable PascalCase CloudFormation logical id for one resource within a
 * component — deployment-agnostic (no project/env/instance segments; logical
 * ids only need to be unique within a single template). Cross-stack outputs
 * should key on this same convention so `stackOutput(...)` resolves by
 * convention (chant#897 scope: "consistent logical IDs and output keys").
 */
export function logicalId(component: string, resource: string): string {
  return `${pascalCase(component)}${pascalCase(resource)}`;
}

function pascalCase(input: string): string {
  return sanitize(input)
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
