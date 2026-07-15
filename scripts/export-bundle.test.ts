/**
 * chant#901 — the exportable artifact bundle. Two levels of proof:
 *
 * 1. Unit-level: `assertValidSelfContainedCfn` (the "prove it" bar this repo
 *    already established in `src/examples/byo/adoption.test.ts` — valid
 *    CloudFormation with no dangling `Ref`/`Fn::GetAtt` targets) actually
 *    catches the failure modes it claims to, and `buildTierManifest` reuses
 *    chant's real Build Archive (`addArchiveTemplate`/`BuildArchiveManifest`)
 *    with the content-addressing property that mechanism promises —
 *    identical template bytes always produce the identical `manifestDigest`.
 * 2. End-to-end: `exportBundle` actually runs `chant build` (via the real,
 *    dev-linked `chant` bin — no mocking) for one tier and asserts the
 *    produced bundle directory has exactly the shape the bundle's own
 *    README documents: a synthesized, valid template per real Loom
 *    component, a Build Archive manifest, and both generated CI pipelines,
 *    parsed and checked for the expected jobs.
 */

import { describe, test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseYAML } from "@intentius/chant/yaml";
import { readBuildManifest } from "@intentius/chant/lifecycle/build-ledger-store";

import {
  COMPONENTS,
  TIERS,
  assertValidSelfContainedCfn,
  InvalidBundleTemplateError,
  buildTierManifest,
  extractCfnParameters,
  exportBundle,
  persistTierManifestToLedger,
  type SynthesizedTemplate,
} from "./export-bundle";

function fixtureTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Resources: {
      Widget: { Type: "AWS::S3::Bucket", Properties: {} },
    },
    ...overrides,
  };
}

describe("assertValidSelfContainedCfn", () => {
  test("accepts a minimal, self-contained template", () => {
    expect(() => assertValidSelfContainedCfn(fixtureTemplate(), "test")).not.toThrow();
  });

  test("accepts a Ref/Fn::GetAtt that resolves to a declared Resource or Parameter", () => {
    const template = fixtureTemplate({
      Parameters: { pName: { Type: "String" } },
      Outputs: {
        oArn: { Value: { "Fn::GetAtt": ["Widget", "Arn"] } },
        oName: { Value: { Ref: "pName" } },
      },
    });
    expect(() => assertValidSelfContainedCfn(template, "test")).not.toThrow();
  });

  test("accepts a Ref to an AWS pseudo parameter", () => {
    const template = fixtureTemplate({
      Outputs: { oRegion: { Value: { Ref: "AWS::Region" } } },
    });
    expect(() => assertValidSelfContainedCfn(template, "test")).not.toThrow();
  });

  test("rejects a dangling Ref", () => {
    const template = fixtureTemplate({
      Outputs: { oBad: { Value: { Ref: "DoesNotExist" } } },
    });
    expect(() => assertValidSelfContainedCfn(template, "test")).toThrow(InvalidBundleTemplateError);
    expect(() => assertValidSelfContainedCfn(template, "test")).toThrow(/dangling reference/);
  });

  test("rejects a dangling Fn::GetAtt", () => {
    const template = fixtureTemplate({
      Outputs: { oBad: { Value: { "Fn::GetAtt": ["Ghost", "Arn"] } } },
    });
    expect(() => assertValidSelfContainedCfn(template, "test")).toThrow(InvalidBundleTemplateError);
  });

  test("rejects a template with no Resources", () => {
    expect(() => assertValidSelfContainedCfn({ AWSTemplateFormatVersion: "2010-09-09", Resources: {} }, "test")).toThrow(/no Resources/);
  });

  test("rejects a resource with no Type", () => {
    const template = fixtureTemplate({ Resources: { Widget: { Properties: {} } } });
    expect(() => assertValidSelfContainedCfn(template, "test")).toThrow(/has no Type/);
  });

  test("rejects the wrong AWSTemplateFormatVersion", () => {
    expect(() => assertValidSelfContainedCfn(fixtureTemplate({ AWSTemplateFormatVersion: "bogus" }), "test")).toThrow(/AWSTemplateFormatVersion/);
  });
});

function fixtureSynth(component: SynthesizedTemplate["component"], content: string): SynthesizedTemplate {
  return {
    component,
    tier: "light",
    archivePath: `templates/${component}.template.json`,
    raw: content,
    template: JSON.parse(content) as Record<string, unknown>,
  };
}

describe("buildTierManifest — reuses chant's real Build Archive", () => {
  test("folds every template into one manifest, content-addressed", () => {
    const templates = [
      fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate())),
      fixtureSynth("loom-db", JSON.stringify(fixtureTemplate({ Resources: { Other: { Type: "AWS::RDS::DBInstance" } } }))),
    ];
    const manifest = buildTierManifest("light", templates, "deadbeef");
    expect(manifest.contents).toHaveLength(2);
    expect(manifest.contents.every((e) => e.kind === "template")).toBe(true);
    expect(manifest.contents.map((e) => e.path).sort()).toEqual(["templates/loom-db.template.json", "templates/shared-foundation.template.json"]);
    expect(manifest.contents.every((e) => e.provenance?.sourceRef === "deadbeef")).toBe(true);
  });

  test("identical template bytes always produce the identical manifestDigest (promote-by-digest)", () => {
    const templates = [fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate()))];
    const a = buildTierManifest("light", templates);
    const b = buildTierManifest("light", templates);
    expect(a.manifestDigest).toBe(b.manifestDigest);
  });

  test("a changed template byte changes the manifestDigest", () => {
    const a = buildTierManifest("light", [fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate()))]);
    const b = buildTierManifest("light", [fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate({ Resources: { Widget: { Type: "AWS::S3::Bucket", Properties: { BucketName: "changed" } } } })))]);
    expect(a.manifestDigest).not.toBe(b.manifestDigest);
  });
});

describe("extractCfnParameters", () => {
  test("reads each template's own Parameters block", () => {
    const templates = [
      fixtureSynth(
        "loom-db",
        JSON.stringify(
          fixtureTemplate({
            Parameters: { ecsSecurityGroupId: { Type: "String", Description: "shared-foundation ECS security group id" } },
          }),
        ),
      ),
      fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate())),
    ];
    const params = extractCfnParameters(templates);
    expect(params["loom-db"]).toEqual({ ecsSecurityGroupId: { type: "String", description: "shared-foundation ECS security group id" } });
    expect(params["shared-foundation"]).toEqual({});
  });
});

describe("persistTierManifestToLedger — reuses chant's real Build Ledger", () => {
  test("round-trips through an isolated scratch git checkout (never touches this repo's own git state)", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "export-bundle-ledger-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: scratch });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: scratch });
      execFileSync("git", ["config", "user.name", "test"], { cwd: scratch });

      const manifest = buildTierManifest("light", [fixtureSynth("shared-foundation", JSON.stringify(fixtureTemplate()))]);
      const result = await persistTierManifestToLedger(manifest, { cwd: scratch });
      expect(result.persisted).toBe(true);
      expect(result.pushed).toBe(false);

      const readBack = await readBuildManifest(manifest.manifestDigest, { cwd: scratch });
      expect(readBack?.manifestDigest).toBe(manifest.manifestDigest);
      expect(readBack?.contents).toHaveLength(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("exportBundle — end to end (real chant build, one tier)", () => {
  const bundleRoot = mkdtempSync(join(tmpdir(), "export-bundle-e2e-"));

  afterAll(() => {
    rmSync(bundleRoot, { recursive: true, force: true });
  });

  test(
    "produces a self-contained light-tier bundle: every real component's template, a Build Archive manifest, and both generated CI pipelines",
    async () => {
      const summary = await exportBundle({ tiers: ["light"], bundleRoot });

      expect(summary.tiers).toHaveLength(1);
      const [tier] = summary.tiers;
      expect(tier.tier).toBe("light");
      expect(tier.components.sort()).toEqual([...COMPONENTS].sort());

      // Every real component's template exists, is valid, self-contained CFN
      // — and `downstream-stub` (a proof-only fixture, never part of a real
      // Loom deployment) is not in the bundle at all.
      for (const component of COMPONENTS) {
        const path = join(bundleRoot, "light", "templates", `${component}.template.json`);
        expect(existsSync(path), `missing template for ${component}`).toBe(true);
        const template = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
        expect(() => assertValidSelfContainedCfn(template, component)).not.toThrow();
      }
      expect(existsSync(join(bundleRoot, "light", "templates", "downstream-stub.template.json"))).toBe(false);

      // Build Archive manifest — reused, not reinvented (chant#609/#613).
      const manifest = JSON.parse(readFileSync(join(bundleRoot, "light", "manifest.json"), "utf-8"));
      expect(manifest.version).toBe(1);
      expect(manifest.contents).toHaveLength(COMPONENTS.length);
      expect(manifest.manifestDigest).toBe(tier.manifestDigest);
      for (const entry of manifest.contents) {
        expect(entry.kind).toBe("template");
        expect(entry.digest).toMatch(/^sha256:/);
      }

      // Generated CI (chant#891/#892) — parses as YAML, expected component jobs present.
      const githubYaml = parseYAML(readFileSync(join(bundleRoot, "light", "ci", "github", "components.yml"), "utf-8"));
      const jobs = githubYaml.jobs as Record<string, unknown>;
      for (const component of COMPONENTS) {
        expect(jobs[component], `missing github job for ${component}`).toBeDefined();
      }

      const gitlabYaml = parseYAML(readFileSync(join(bundleRoot, "light", "ci", "gitlab", ".gitlab-ci.yml"), "utf-8"));
      for (const component of COMPONENTS) {
        expect(gitlabYaml[component], `missing gitlab job for ${component}`).toBeDefined();
      }

      // README + index.
      expect(existsSync(join(bundleRoot, "README.md"))).toBe(true);
      const readme = readFileSync(join(bundleRoot, "README.md"), "utf-8");
      expect(readme).toContain("aws cloudformation deploy");
      expect(readme).toContain(tier.manifestDigest);

      const index = JSON.parse(readFileSync(join(bundleRoot, "index.json"), "utf-8"));
      expect(index.version).toBeTruthy();
      expect(index.tiers).toHaveLength(1);
    },
    60_000,
  );

  test("covers every tier this repo's README documents", () => {
    expect(TIERS).toEqual(["light", "production", "production-ha"]);
  });
});
