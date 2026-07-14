import { describe, test, expect } from "vitest";
import * as ts from "typescript";
import { noHardcodedNameRule } from "./no-hardcoded-name";
import type { LintContext } from "@intentius/chant";

function createContext(code: string, filePath = "src/composites/foundation.component.ts"): LintContext {
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
  return { sourceFile, entities: [], filePath, lexicon: undefined };
}

describe("LOOM001: no-hardcoded-name", () => {
  test("rule metadata", () => {
    expect(noHardcodedNameRule.id).toBe("LOOM001");
    expect(noHardcodedNameRule.severity).toBe("warning");
    expect(noHardcodedNameRule.category).toBe("correctness");
  });

  test("triggers on a hardcoded BucketName", () => {
    const ctx = createContext(`new Bucket({ BucketName: "my-static-bucket" });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("LOOM001");
    expect(diags[0].message).toContain("BucketName");
  });

  test.each([
    "DBInstanceIdentifier",
    "DBProxyName",
    "LoadBalancerName",
    "TargetGroupName",
    "RepositoryName",
    "ClusterName",
    "ServiceName",
    "Domain",
    "UserPoolName",
    "Name",
  ])("triggers on hardcoded %s", (key) => {
    const ctx = createContext(`new Foo({ ${key}: "literal-value" });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(1);
  });

  test("does not trigger when the value comes from the naming helper", () => {
    const ctx = createContext(`new Bucket({ BucketName: naming.name("uploads", { service: "s3Bucket" }) });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(0);
  });

  test("does not trigger on a variable reference", () => {
    const ctx = createContext(`new Bucket({ BucketName: bucketName });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(0);
  });

  test("does not trigger on a template literal with a substitution", () => {
    const ctx = createContext("new Bucket({ BucketName: `${prefix}-uploads` });");
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(0);
  });

  test("does not trigger on properties outside the known physical-name key set", () => {
    const ctx = createContext(`new Bucket({ VersioningConfiguration: { Status: "Enabled" } });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(0);
  });

  test("does not scan files outside composites/components", () => {
    const ctx = createContext(`new Bucket({ BucketName: "my-static-bucket" });`, "src/lib/naming.ts");
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(0);
  });

  test("scans .component.ts files regardless of directory", () => {
    const ctx = createContext(`new Bucket({ BucketName: "my-static-bucket" });`, "loom-backend.component.ts");
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(1);
  });

  test("scans files under src/composites/", () => {
    const ctx = createContext(`new Bucket({ BucketName: "my-static-bucket" });`, "src/composites/shared-foundation.ts");
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags).toHaveLength(1);
  });

  test("reports line and column at the literal", () => {
    const ctx = createContext(`new Bucket({ BucketName: "my-static-bucket" });`);
    const diags = noHardcodedNameRule.check(ctx);
    expect(diags[0].line).toBe(1);
    expect(diags[0].column).toBeGreaterThan(0);
  });
});
