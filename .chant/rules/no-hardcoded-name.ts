/**
 * LOOM001: no-hardcoded-name (chant#897)
 *
 * Flags a string-literal value on a known AWS physical-name-bearing
 * CloudFormation property (e.g. `BucketName`, `DBInstanceIdentifier`,
 * `LoadBalancerName`) inside a Loom composite or component file. Every
 * physical name must come from the shared naming helper
 * (`loomNaming(...).name(...)`, `src/lib/naming.ts`) so it carries the
 * project/env/instance segments that keep deployments collision-free
 * (chant#897 acceptance: "grep shows zero hardcoded physical names in any
 * composite").
 *
 * Scope: only scans `*.component.ts` files and files under `src/composites/`
 * or `src/components/` — the naming helper's own source/tests, docs, and
 * unrelated project files are not composites and are left alone.
 *
 * Triggers on: new Bucket({ BucketName: "my-static-bucket" })
 * OK: new Bucket({ BucketName: naming.name("uploads", { service: "s3Bucket" }) })
 * OK: new Bucket({ BucketName: someVariable })
 * OK: new Bucket({ VersioningConfiguration: { Status: "Enabled" } }) — not a known name key
 */

import * as ts from "typescript";
import type { LintRule, LintContext, LintDiagnostic } from "@intentius/chant";

/**
 * CloudFormation properties that carry a resource's physical name, across
 * the AWS services Loom's real footprint touches (chant#885: ALB/ECS/RDS/
 * Cognito/ECR/S3/IAM/logs/secrets).
 */
const PHYSICAL_NAME_KEYS = new Set([
  "Name",
  "BucketName",
  "DBInstanceIdentifier",
  "DBProxyName",
  "DBSubnetGroupName",
  "DBClusterIdentifier",
  "LoadBalancerName",
  "TargetGroupName",
  "RepositoryName",
  "ClusterName",
  "ServiceName",
  "Family",
  "Domain",
  "UserPoolName",
  "RoleName",
  "PolicyName",
  "LogGroupName",
  "SecretName",
  "AliasName",
  "QueueName",
  "TopicName",
  "TableName",
  "FunctionName",
  "RestApiName",
  "StateMachineName",
  "StreamName",
  "RuleName",
]);

function isComposeFile(filePath: string): boolean {
  return filePath.endsWith(".component.ts") || /\/(src\/)?composites\//.test(filePath) || /\/(src\/)?components\//.test(filePath);
}

function propertyKeyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/** A plain string literal or a template literal with no `${...}` substitutions. */
function isStaticStringLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function checkNode(node: ts.Node, context: LintContext, diagnostics: LintDiagnostic[]): void {
  if (ts.isPropertyAssignment(node)) {
    const key = propertyKeyName(node.name);
    if (key && PHYSICAL_NAME_KEYS.has(key) && isStaticStringLiteral(node.initializer)) {
      const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
        node.initializer.getStart(context.sourceFile),
      );

      diagnostics.push({
        file: context.filePath,
        line: line + 1,
        column: character + 1,
        ruleId: "LOOM001",
        severity: "warning",
        message: `Hardcoded physical name on '${key}' — derive it from the shared naming helper (loomNaming(...).name(...)) instead of a literal, so it carries the project/env/instance segments.`,
      });
    }
  }

  ts.forEachChild(node, (child) => checkNode(child, context, diagnostics));
}

export const noHardcodedNameRule: LintRule = {
  id: "LOOM001",
  severity: "warning",
  category: "correctness",
  description: "Loom composites must derive physical resource names from the shared naming helper, not a literal",
  helpUri: "https://github.com/INTENTIUS/chant/issues/897",
  check(context: LintContext): LintDiagnostic[] {
    if (!isComposeFile(context.filePath)) return [];
    const diagnostics: LintDiagnostic[] = [];
    checkNode(context.sourceFile, context, diagnostics);
    return diagnostics;
  },
};
