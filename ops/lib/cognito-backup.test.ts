import { describe, test, expect } from "vitest";
import { cognitoUserExportScript } from "./cognito-backup";

const cognitoUserPoolName = "loom-prod-a-loom-cognito-pool";

describe("cognitoUserExportScript (Cognito user-pool export)", () => {
  test("resolves the AWS-generated pool id by its deterministic name at run time", () => {
    const script = cognitoUserExportScript({ cognitoUserPoolName });
    expect(script).toContain(`UserPools[?Name=='${cognitoUserPoolName}'].Id`);
    expect(script).toContain("set -euo pipefail");
  });

  test("fails loudly when no pool with that name exists", () => {
    const script = cognitoUserExportScript({ cognitoUserPoolName });
    expect(script).toContain("exit 1");
  });

  test("exports users, groups, and per-group memberships", () => {
    const script = cognitoUserExportScript({ cognitoUserPoolName });
    expect(script).toContain("aws cognito-idp list-users --user-pool-id");
    expect(script).toContain("aws cognito-idp list-groups --user-pool-id");
    expect(script).toContain("aws cognito-idp list-users-in-group --user-pool-id");
  });

  test("emits one combined JSON document to stdout", () => {
    const script = cognitoUserExportScript({ cognitoUserPoolName });
    expect(script).toContain("users: $users.Users");
    expect(script).toContain("groups: $groups.Groups");
    expect(script).toContain("memberships: $memberships");
    expect(script).toContain('echo "$EXPORT"');
  });

  test("also writes to S3 only when LOOM_BACKUP_BUCKET is set", () => {
    const script = cognitoUserExportScript({ cognitoUserPoolName });
    expect(script).toContain('if [ -n "${LOOM_BACKUP_BUCKET:-}" ]');
    expect(script).toContain("aws s3 cp -");
  });
});
