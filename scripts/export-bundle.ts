/**
 * scripts/export-bundle.ts — the exportable artifact bundle (chant#901).
 *
 * The third Loom-on-chant adoption on-ramp, beyond "run chant" (#895) and
 * "adopt the chant project": consume the output, skip the tool. A team
 * grabs the pre-synthesized CloudFormation templates + generated CI this
 * script produces and deploys with plain `aws cloudformation deploy` — no
 * chant install.
 *
 * **Reuses the shipped mechanism, invents no new format.** Per chant#901's
 * settled decision, this is a thin export/hand-off of chant's existing
 * Build Archive (`@intentius/chant/components/verbs/build-archive` +
 * `.../build`'s `addArchiveTemplate` — a `template` is a first-class
 * content-addressed archive entry, chant#613) and Build Ledger
 * (`@intentius/chant/lifecycle/build-ledger-store`, chant#609) — the exact
 * modules a `docker-build`/config-BOM component step already accumulates a
 * manifest through (see e.g. `lexicons/aws/src/components/config-bom.ts` in
 * the chant repo). Nothing here defines a new archive/bundle shape: every
 * template this script writes is folded into a `BuildArchiveManifest` via
 * `addArchiveTemplate`, content-addressed exactly as `chant build`'s own
 * archive-producing capabilities already do it, and persisted to the same
 * `chant/lifecycle` orphan branch `persistBuildManifest` always writes to.
 *
 * **What "export" adds — the actual chant#901 gap.** Reading the archive
 * back today requires chant (`chant components status`, or applying
 * straight from the orphan-branch ledger). This script materializes one
 * tier's manifest + every `template` entry it references, plus the
 * generated GitHub/GitLab CI (`chant build --components --generate
 * <lexicon>`), to a plain directory a non-chant consumer can read with `ls`
 * and deploy with the AWS CLI alone.
 *
 * **Per-tier bundles** (light / production / production-ha) so a consumer
 * picks a tier and deploys — see `README.md` (this repo's root) for the
 * tier/component matrix and `docs/adoption.md` for every BYO seam. Pinned
 * to Loom `v1.6.0` (`LOOM_VERSION` below) — a human version label layered
 * on top of the manifest's own content digest, per chant#901's "optional
 * human version label ... pinned to the Loom release" acceptance line; the
 * digest, not this label, is what `manifestDigest`/promote-by-digest key
 * off.
 *
 * **BYO-seam placeholders.** `shared-foundation`'s network/domain seams and
 * `loom-db`'s network/password seam are always reference-existing/
 * externally supplied (docs/adoption.md) — there is no from-scratch value
 * chant can synthesize for a real VPC id or DB master password. This script
 * falls back to clearly-labeled example values (`EXAMPLE_PARAMS` below)
 * *only* for whichever of those an adopter's own environment leaves unset,
 * so the bundle this script produces out of the box is a runnable
 * reference architecture; a real adopter overrides them by exporting their
 * own `LOOM_VPC_ID`/`LOOM_DB_PASSWORD`/etc. before running this script —
 * the bundle produced is then byte-identical to a real `chant build` of
 * *their* configuration, no hand edits to the templates this script writes.
 *
 * **Known upstream limitation.** A handful of the auto-detected
 * cross-lexicon output entries chant's own build pipeline emits
 * (`detectCrossLexiconRefs`/`LexiconOutput.auto`, `packages/core/src/build.ts`
 * in the chant repo) carry a `.`-bearing logical id (e.g.
 * `foundationArtifactBucket_MetadataConfiguration.AnnotationTableConfiguration.TableArn`)
 * that isn't a valid CloudFormation logical id (alphanumeric only) — a
 * pre-existing chant-core defect, not something this export step
 * introduces or silently patches over (patching the JSON here would break
 * "byte-identical to what `chant build` produced"). Filed upstream as
 * `INTENTIUS/chant#930`. None of Loom's own
 * meaningful named outputs (`oAlbArn`, `oArtifactBucket`, ...) are affected
 * — only these extra, auto-detected entries are — and `assertValidCfn`
 * below still catches anything that would leave a template genuinely
 * broken (a dangling `Ref`/`Fn::GetAtt`, a resource with no `Type`).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBuildArchiveManifest,
  type BuildArchiveManifest,
} from "@intentius/chant/components/verbs/build-archive";
import { addArchiveTemplate } from "@intentius/chant/components/verbs/build";
import { persistBuildManifest } from "@intentius/chant/lifecycle/build-ledger-store";
import { pushLifecycle } from "@intentius/chant/lifecycle/git";

// ── Constants ────────────────────────────────────────────────────────────

/** Loom release this bundle is pinned to (README.md: "Pinned to Loom v1.6.0"). The human label layered on `manifestDigest` — see module doc. */
export const LOOM_VERSION = "v1.6.0";

export const TIERS = ["light", "production", "production-ha"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * The real, deployed Loom stacks (README.md's "Components" table) — in
 * dependency order. Deliberately excludes `downstream-stub`: a
 * proof-only fixture for chant#886's stackOutput() resolution acceptance,
 * never part of a real Loom deployment (see `src/downstream-stub/stub.ts`'s
 * docstring) — nothing a real adopter would deploy, so it stays out of the
 * consumable bundle even though it's still a component the generated CI
 * pipelines cover.
 */
export const COMPONENTS = [
  "shared-foundation",
  "loom-cognito",
  "loom-db",
  "loom-frontend",
  "loom-backend",
  "loom-agents",
] as const;
export type ComponentName = (typeof COMPONENTS)[number];

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHANT_BIN = join(REPO_ROOT, "node_modules", ".bin", "chant");

export function defaultBundleRoot(version: string = LOOM_VERSION): string {
  return join(REPO_ROOT, "dist", "bundle", `loom-${version}`);
}

/**
 * Example values for the BYO seams every tier needs (docs/adoption.md):
 * `shared-foundation`'s reference-existing network (always required on
 * production/production-ha; light provisions its own VPC) and custom
 * domain (production/production-ha only), and `loom-db`'s
 * always-reference-existing network + master password (loom-db never
 * provisions a VPC — see `src/composites/loom-db.ts`'s module doc). Used
 * only to fill in whatever the calling environment leaves unset — see
 * `tierEnv` below.
 */
export const EXAMPLE_PARAMS: Readonly<Record<string, string>> = Object.freeze({
  LOOM_VPC_ID: "vpc-0123456789abcdef0",
  LOOM_PUBLIC_SUBNET_IDS: "subnet-0aaaaaaaaa1111111,subnet-0bbbbbbbbb2222222",
  LOOM_PRIVATE_SUBNET_IDS: "subnet-0ccccccccc3333333,subnet-0ddddddddd4444444",
  LOOM_DOMAIN_NAME: "loom.example.com",
  LOOM_DB_PASSWORD: "CHANGE_ME_use_a_real_secret_manager_value",
});

/** Env for one tier's synth: the calling process's own env wins over `EXAMPLE_PARAMS`, `LOOM_TIER` always reflects the tier being built. */
export function tierEnv(tier: Tier, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...EXAMPLE_PARAMS, ...base, LOOM_TIER: tier };
}

// ── Synthesis ────────────────────────────────────────────────────────────

export interface SynthesizedTemplate {
  component: ComponentName;
  tier: Tier;
  /** Archive-relative path (`templates/<component>.template.json`). */
  archivePath: string;
  /** Exact bytes `chant build` wrote — what gets content-addressed and what a consumer deploys, unmodified. */
  raw: string;
  template: Record<string, unknown>;
}

/**
 * Run the same command `npm run synth:<component>` already documents
 * (`chant build src/<component> --lexicon aws -o <file>`), against the
 * local `chant` bin (the same dev-linked `@intentius/chant` every other
 * script in this repo resolves) — never a re-implementation of synthesis.
 */
export function synthesizeTemplate(component: ComponentName, tier: Tier, outDir: string, env: NodeJS.ProcessEnv = process.env): SynthesizedTemplate {
  const archivePath = `templates/${component}.template.json`;
  const outFile = join(outDir, archivePath);
  mkdirSync(dirname(outFile), { recursive: true });
  execFileSync(CHANT_BIN, ["build", `src/${component}`, "--lexicon", "aws", "-o", outFile], {
    cwd: REPO_ROOT,
    env: tierEnv(tier, env),
    stdio: ["ignore", "ignore", "pipe"],
  });
  const raw = readFileSync(outFile, "utf-8");
  return { component, tier, archivePath, raw, template: JSON.parse(raw) as Record<string, unknown> };
}

// ── Validity ("prove it") ────────────────────────────────────────────────

/** CloudFormation pseudo parameters — always a resolvable `Ref` target even though no template ever declares them (mirrors `src/examples/byo/adoption.test.ts`'s dangling-ref convention, extended to not misfire on a legitimate pseudo-parameter `Ref`). */
const PSEUDO_PARAMETERS = new Set([
  "AWS::AccountId",
  "AWS::NotificationARNs",
  "AWS::NoValue",
  "AWS::Partition",
  "AWS::Region",
  "AWS::StackId",
  "AWS::StackName",
  "AWS::URLSuffix",
]);

export class InvalidBundleTemplateError extends Error {}

/**
 * The bar this repo already established for "valid CloudFormation"
 * (`src/examples/byo/adoption.test.ts`: "serializes to valid CloudFormation
 * with no dangling Ref/Fn::GetAtt targets") — reused here rather than
 * introducing a stricter, tool-dependent bar for this one script. Checks,
 * in order: parses as an object with the expected top-level shape, every
 * resource declares a `Type`, and every `Ref`/`Fn::GetAtt` target in
 * Resources/Outputs resolves to a declared Resource, Parameter, or AWS
 * pseudo-parameter — i.e. the template is self-contained (chant#901's
 * "templates are valid CFN and self-contained" acceptance line).
 */
export function assertValidSelfContainedCfn(template: Record<string, unknown>, label: string): void {
  if (template.AWSTemplateFormatVersion !== "2010-09-09") {
    throw new InvalidBundleTemplateError(`${label}: missing/unexpected AWSTemplateFormatVersion`);
  }
  const resources = (template.Resources ?? {}) as Record<string, unknown>;
  if (Object.keys(resources).length === 0) {
    throw new InvalidBundleTemplateError(`${label}: template has no Resources`);
  }
  for (const [logicalId, resource] of Object.entries(resources)) {
    const type = (resource as Record<string, unknown> | null)?.Type;
    if (typeof type !== "string" || type.length === 0) {
      throw new InvalidBundleTemplateError(`${label}: resource "${logicalId}" has no Type`);
    }
  }

  const known = new Set([...Object.keys(resources), ...Object.keys((template.Parameters ?? {}) as Record<string, unknown>)]);
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.Ref === "string") found.add(obj.Ref);
      if (obj["Fn::GetAtt"] !== undefined) {
        const target = obj["Fn::GetAtt"];
        const logicalId = Array.isArray(target) ? (target[0] as string) : (target as string).split(".")[0];
        found.add(logicalId);
      }
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(template.Resources);
  walk(template.Outputs);

  for (const id of found) {
    if (PSEUDO_PARAMETERS.has(id)) continue;
    if (!known.has(id)) {
      throw new InvalidBundleTemplateError(`${label}: dangling reference to unknown logical id "${id}"`);
    }
  }
}

// ── Build Archive manifest (reuse, no new format) ───────────────────────

/** Fold every synthesized template for one tier into a single `BuildArchiveManifest` — one manifest per tier, exactly the accumulation convention `docker-build`/`addArchiveTemplate` already document ("manifest to extend ... accumulates one manifest across a component's whole build phase"). */
export function buildTierManifest(tier: Tier, templates: SynthesizedTemplate[], sourceRef?: string): BuildArchiveManifest {
  let manifest = createBuildArchiveManifest(`loom-${tier}`);
  for (const t of templates) {
    ({ manifest } = addArchiveTemplate({ path: t.archivePath, content: t.raw, manifest, sourceRef }));
  }
  return manifest;
}

/** Current git commit of this checkout, for the archive entries' `provenance.sourceRef` (chant#614) — best-effort, `undefined` outside a git checkout. */
export function currentGitSha(cwd: string = REPO_ROOT): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
}

/**
 * Persist a tier's manifest to the `chant/lifecycle` orphan branch — the
 * same Build Ledger every other durable manifest write goes through
 * (`persistBuildManifest`, chant#609). Local git plumbing only
 * (hash-object/mktree/commit-tree/update-ref, no checkout) — never pushes
 * on its own; pass `push: true` (wired to `--persist-ledger` below) to also
 * `pushLifecycle` to the remote. Off by default so a plain `npm run
 * export-bundle` never mutates shared git state as a side effect — an
 * adopter (or CI) opts in explicitly once they mean for this bundle's
 * manifest to become the durably-recorded one.
 */
export async function persistTierManifestToLedger(
  manifest: BuildArchiveManifest,
  opts: { cwd?: string; push?: boolean } = {},
): Promise<{ persisted: boolean; commit?: string; pushed?: boolean }> {
  const { commit } = await persistBuildManifest(manifest, { cwd: opts.cwd });
  if (!opts.push) return { persisted: true, commit, pushed: false };
  const pushed = await pushLifecycle({ cwd: opts.cwd });
  return { persisted: true, commit, pushed };
}

export interface CfnParameterInfo {
  type: string;
  description?: string;
}

/** Extract each synthesized template's own `Parameters` block for the README's parameter reference — read straight from what `chant build` emitted (self-documenting: every cross-stack `Parameter` in this repo already carries a `Description` naming the upstream output it's filled from, e.g. "ECS cluster ARN (shared-foundation oEcsClusterArn)") rather than hand-maintained and liable to drift from the real templates. */
export function extractCfnParameters(templates: SynthesizedTemplate[]): Record<ComponentName, Record<string, CfnParameterInfo>> {
  const byComponent = {} as Record<ComponentName, Record<string, CfnParameterInfo>>;
  for (const t of templates) {
    const params = (t.template.Parameters ?? {}) as Record<string, { Type?: string; Description?: string }>;
    const entries: Record<string, CfnParameterInfo> = {};
    for (const [name, def] of Object.entries(params)) {
      entries[name] = { type: def.Type ?? "String", description: def.Description };
    }
    byComponent[t.component] = entries;
  }
  return byComponent;
}

// ── Generated CI ─────────────────────────────────────────────────────────

export interface GeneratedCi {
  githubYaml: string;
  gitlabYaml: string;
}

/**
 * Run the exact `chant build --components --generate <lexicon>` commands
 * this repo's own `npm run generate:github`/`generate:gitlab` scripts wrap
 * (chant#891/#892) — one generation each, reused verbatim across every
 * tier's bundle (the generated pipeline doesn't vary by tier; only the
 * `LOOM_TIER` a runner exports at deploy time does), so every tier's `ci/`
 * copy is byte-identical.
 */
export function generateCiPipelines(scratchDir: string): GeneratedCi {
  mkdirSync(scratchDir, { recursive: true });
  const githubOut = join(scratchDir, "components.yml");
  const gitlabOut = join(scratchDir, ".gitlab-ci.yml");
  execFileSync(CHANT_BIN, ["build", "--components", "--generate", "github", "-o", githubOut], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync(CHANT_BIN, ["build", "--components", "--generate", "gitlab", "-o", gitlabOut], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return { githubYaml: readFileSync(githubOut, "utf-8"), gitlabYaml: readFileSync(gitlabOut, "utf-8") };
}

// ── README ───────────────────────────────────────────────────────────────

function tierParamNote(tier: Tier): string {
  if (tier === "light") {
    return "`shared-foundation` provisions its own VPC/subnets on `light` — `loom-db` still needs `LOOM_VPC_ID`/`LOOM_PRIVATE_SUBNET_IDS` set to that VPC's own ids (loom-db never provisions a VPC itself; see docs/adoption.md).";
  }
  return "`shared-foundation` requires a pre-existing VPC (`LOOM_VPC_ID`/`LOOM_PUBLIC_SUBNET_IDS`/`LOOM_PRIVATE_SUBNET_IDS`) and a custom domain (`LOOM_DOMAIN_NAME`) on this tier — see docs/adoption.md's reference-existing-network case.";
}

/** Per-component CloudFormation `Parameters` table for one tier — read straight from `templates/*.template.json`'s own `Parameters` block (see `extractCfnParameters`), so it can never drift from what's actually in this tier's templates. A component with zero `Parameters` (e.g. `shared-foundation`, `loom-cognito` at their defaults) is omitted — nothing to fill in for `aws cloudformation deploy --parameter-overrides` there. */
function renderCfnParameterTable(tier: TierSummary): string {
  const sections: string[] = [];
  for (const component of tier.components) {
    const params = tier.parameters[component] ?? {};
    const names = Object.keys(params);
    if (names.length === 0) continue;
    const rows = names.map((name) => `| \`${name}\` | \`${params[name].type}\` | ${params[name].description ?? "—"} |`).join("\n");
    sections.push(`**\`${component}\`** (\`--parameter-overrides\` for \`templates/${component}.template.json\`):\n\n| Parameter | Type | Description |\n|---|---|---|\n${rows}`);
  }
  return sections.length > 0 ? sections.join("\n\n") : "_No component in this tier declares a CloudFormation `Parameter` — every input is baked in at synthesis time._";
}

function renderReadme(summary: ExportSummary): string {
  const tierRows = summary.tiers
    .map((t) => `| \`${t.tier}\` | ${t.components.length} | \`${t.manifestDigest}\` |`)
    .join("\n");

  return `# loom-on-chant — exportable artifact bundle

Pinned to **Loom \`${LOOM_VERSION}\`**. Generated by \`npm run export-bundle\`
(\`scripts/export-bundle.ts\`, chant#901) from this repo's own \`chant build\`
output — every template below is byte-identical to what \`chant build\`
produced; nothing here is hand-edited.

**No chant install required to deploy this.** Each tier directory is
self-contained: synthesized CloudFormation templates, a generated GitHub
Actions workflow and GitLab CI pipeline, and this tier's own
\`manifest.json\` (chant's Build Archive manifest — see "Provenance" below).

## Tiers

| Tier | Components | Manifest digest |
|---|---|---|
${tierRows}

Pick one tier directory (\`light/\`, \`production/\`, or \`production-ha/\`) and
deploy everything inside it — see docs/adoption.md (this repo's root) for
the full tier/seam matrix. Tier choice affects resource shape (single-AZ vs.
Multi-AZ RDS, an RDS Proxy, PrivateLink, ...), not the deploy mechanics
below.

## Deploy order

Deploy each tier's templates in this order — later stacks reference
earlier ones' outputs:

1. \`shared-foundation\` — ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role
2. \`loom-cognito\` — Cognito UserPool, hosted-UI domain, resource server, clients
3. \`loom-db\` — RDS Postgres, Secrets Manager, (production/production-ha) RDS Proxy
4. \`loom-frontend\` — the frontend ECS Fargate service
5. \`loom-backend\` — the backend ECS Fargate service
6. \`loom-agents\` — the Bedrock AgentCore agent set

\`\`\`sh
aws cloudformation deploy \\
  --template-file templates/shared-foundation.template.json \\
  --stack-name loom-shared-foundation \\
  --capabilities CAPABILITY_NAMED_IAM
# repeat per component, in the order above, threading each stack's own
# Outputs into the next one's --parameter-overrides (see below).
\`\`\`

## Parameter reference

Every input a composite couldn't synthesize from scratch (a physical name,
an already-known account resource) is either baked into these templates as
the value \`chant build\` was run with, or left as a genuine CloudFormation
\`Parameter\` for a cross-stack reference (e.g. \`loom-db\`'s
\`EcsSecurityGroupId\`, filled from \`shared-foundation\`'s own
\`oEcsSecurityGroupId\` output via \`--parameter-overrides\`). The **chant-level**
env vars below are what this bundle's templates were synthesized with —
not CloudFormation parameters — so re-running \`chant build\` (with chant
installed) is how you change them, not editing the JSON:

| Env var | Used by | Meaning |
|---|---|---|
| \`LOOM_TIER\` | every component | \`light\` \\| \`production\` \\| \`production-ha\` — this bundle ships one directory per tier |
| \`LOOM_VPC_ID\` / \`LOOM_PUBLIC_SUBNET_IDS\` / \`LOOM_PRIVATE_SUBNET_IDS\` | \`shared-foundation\` (production/production-ha only), \`loom-db\` (every tier) | A pre-existing VPC's own ids — \`loom-db\` never provisions a VPC (docs/adoption.md) |
| \`LOOM_DOMAIN_NAME\` | \`shared-foundation\` (production/production-ha only) | Custom domain name, DNS-validated against the referenced Route53 zone |
| \`LOOM_DB_PASSWORD\` | \`loom-db\` | RDS master password (\`data.mode: provision\`, the default) |
| \`LOOM_DB_MODE\` | \`loom-db\` | \`provision\` (default) \\| \`reference-existing\` \\| \`omit\` — bring-your-own-DB |
| \`LOOM_COGNITO_MODE\` / similar per-composite seams | \`loom-cognito\`, others | See docs/adoption.md's full seam matrix (\`provision\` \\| \`reference-existing\` \\| \`omit\` per composite) |

**This bundle's own templates were synthesized with example placeholder
values** (\`vpc-0123456789abcdef0\`, \`loom.example.com\`, ...) wherever the
building environment left one of the above unset — clearly not real
resource ids. Treat this as a runnable reference architecture, not a
deploy-as-is production config: re-run \`npm run export-bundle\` with your
own values exported first (or hand this env-var table to whoever owns the
real ones) to get a bundle tailored to a real deployment.

${summary.tiers.map((t) => `### \`${t.tier}\`\n\n${tierParamNote(t.tier)}\n\n${renderCfnParameterTable(t)}`).join("\n")}

## Generated CI

\`ci/github/components.yml\` and \`ci/gitlab/.gitlab-ci.yml\` are
\`chant build --components --generate github|gitlab\`'s output (chant#891/
#892) — one thin trigger job per component, wave-ordered by \`dependsOn\`,
with cross-stack outputs threaded as job artifacts. They assume \`chant\`
(and this repo's own \`node_modules\`) are available to the runner that
executes them — wire a custom runner image or a \`beforeScript: ["npm ci"]\`
step, same as this repo's own README documents for a real GitLab runner.
Deploying via plain \`aws cloudformation deploy\` (above) needs neither file
at all.

## Provenance — chant's Build Archive + Build Ledger, not a new format

Per chant#901's settled decision, this bundle reuses chant's existing
mechanisms rather than inventing packaging:

- **\`manifest.json\`** (one per tier) is a chant \`BuildArchiveManifest\`
  (\`@intentius/chant/components/verbs/build-archive\`) — the same
  content-addressed structure \`docker-build\`/\`generate-sbom\` accumulate for
  a component's image builds, extended here with \`addArchiveTemplate\` for
  each synthesized CloudFormation document. Every \`template\`-kind entry
  carries the exact digest of the bytes in \`templates/\`, and the manifest's
  own \`manifestDigest\` is stable across identical rebuilds — a promoted
  digest always traces back to exactly the manifest (and templates) that
  produced it.
- These manifests can also be persisted to this repo's \`chant/lifecycle\`
  orphan branch (chant's Build Ledger, \`persistBuildManifest\`) — the
  durable record a chant-equipped consumer reads back with \`chant
  components status\`. \`npm run export-bundle\` does this only when
  \`EXPORT_PERSIST_LEDGER=true\` (off by default, so a plain export never
  mutates this repo's git state as a side effect) — see
  \`scripts/export-bundle.sh\`. This export is the portable copy for
  everyone else, regardless of whether that flag was set.

## Known upstream limitation

A small number of auto-detected cross-lexicon output entries in these
templates (chant core's \`detectCrossLexiconRefs\`) carry a logical id that
isn't valid CloudFormation (dotted nested-attribute names, e.g.
\`..._MetadataConfiguration.AnnotationTableConfiguration.TableArn\`) — a
pre-existing chant-core defect unrelated to Loom's own composites, tracked
upstream as \`INTENTIUS/chant#930\`. None of
Loom's meaningfully-named outputs (\`oAlbArn\`, \`oArtifactBucket\`, ...) are
affected. A real deploy of an affected template should drop those specific
extra \`Outputs\` entries (or wait for the upstream fix) — \`shared-foundation\`
is the stack affected today.
`;
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface TierSummary {
  tier: Tier;
  components: ComponentName[];
  manifestDigest: string;
  parameters: Record<ComponentName, Record<string, CfnParameterInfo>>;
}

export interface ExportSummary {
  version: string;
  chantVersion: string;
  generatedAt: string;
  bundleRoot: string;
  tiers: TierSummary[];
}

export interface ExportBundleOptions {
  tiers?: readonly Tier[];
  components?: readonly ComponentName[];
  bundleRoot?: string;
  version?: string;
  /** Also `pushLifecycle` to the remote after persisting each tier's manifest — off by default, see `persistTierManifestToLedger`. */
  persistLedger?: boolean;
  pushLedger?: boolean;
  env?: NodeJS.ProcessEnv;
}

function chantCoreVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "@intentius", "chant", "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function exportBundle(options: ExportBundleOptions = {}): Promise<ExportSummary> {
  const tiers = options.tiers ?? TIERS;
  const components = options.components ?? COMPONENTS;
  const version = options.version ?? LOOM_VERSION;
  const bundleRoot = options.bundleRoot ?? defaultBundleRoot(version);
  const sourceRef = currentGitSha();
  const env = options.env ?? process.env;

  rmSync(bundleRoot, { recursive: true, force: true });
  mkdirSync(bundleRoot, { recursive: true });

  const scratchDir = join(bundleRoot, ".ci-scratch");
  const ci = generateCiPipelines(scratchDir);

  const tierSummaries: TierSummary[] = [];
  for (const tier of tiers) {
    const tierDir = join(bundleRoot, tier);
    const templates: SynthesizedTemplate[] = [];
    for (const component of components) {
      const t = synthesizeTemplate(component, tier, tierDir, env);
      assertValidSelfContainedCfn(t.template, `${tier}/${component}`);
      templates.push(t);
    }

    const manifest = buildTierManifest(tier, templates, sourceRef);
    writeFileSync(join(tierDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    if (options.persistLedger) {
      await persistTierManifestToLedger(manifest, { cwd: REPO_ROOT, push: options.pushLedger });
    }

    mkdirSync(join(tierDir, "ci", "github"), { recursive: true });
    mkdirSync(join(tierDir, "ci", "gitlab"), { recursive: true });
    writeFileSync(join(tierDir, "ci", "github", "components.yml"), ci.githubYaml);
    writeFileSync(join(tierDir, "ci", "gitlab", ".gitlab-ci.yml"), ci.gitlabYaml);

    tierSummaries.push({
      tier,
      components: templates.map((t) => t.component),
      manifestDigest: manifest.manifestDigest,
      parameters: extractCfnParameters(templates),
    });
  }

  rmSync(scratchDir, { recursive: true, force: true });

  const summary: ExportSummary = {
    version,
    chantVersion: chantCoreVersion(),
    generatedAt: new Date().toISOString(),
    bundleRoot,
    tiers: tierSummaries,
  };

  writeFileSync(join(bundleRoot, "index.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(bundleRoot, "README.md"), renderReadme(summary));

  return summary;
}

// ── CLI entry ─────────────────────────────────────────────────────────────

function isMain(): boolean {
  const entry = process.argv[1];
  return !!entry && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const persistLedger = process.env.EXPORT_PERSIST_LEDGER === "true";
  const pushLedger = process.env.EXPORT_PUSH_LEDGER === "true";
  exportBundle({ persistLedger, pushLedger })
    .then((summary) => {
      console.log(`export-bundle: wrote ${summary.tiers.length} tier(s) to ${summary.bundleRoot}`);
      for (const t of summary.tiers) {
        console.log(`  ${t.tier}: ${t.components.length} template(s), manifestDigest ${t.manifestDigest}`);
      }
    })
    .catch((err) => {
      console.error(`export-bundle: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
