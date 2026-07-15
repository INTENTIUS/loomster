import { describe, test, expect } from "vitest";
import {
  cognitoCreateReplacementClientScript,
  cognitoDeleteOldClientScript,
  rdsRotateNativeScript,
  rdsRotateManualScript,
  acmRequestScript,
  acmSwapListenerScript,
} from "./rotation";

describe("Cognito M2M app-client rotation (chant#905 — no in-place secret regeneration API)", () => {
  const opts = {
    userPoolName: "loom-prod-a-loom-cognito-pool",
    oldClientName: "loom-prod-a-loom-cognito-m2m-client",
    replacementSecretName: "loom-prod-a-loom-cognito-m2m-client-rotated",
  };

  test("creates a new client copying the outgoing client's OAuth flow/scope config, not a re-guessed one", () => {
    const script = cognitoCreateReplacementClientScript(opts);
    expect(script).toContain(`--query "UserPools[?Name=='${opts.userPoolName}'].Id | [0]"`);
    expect(script).toContain(`--query "UserPoolClients[?ClientName=='${opts.oldClientName}'].ClientId | [0]"`);
    expect(script).toContain("aws cognito-idp describe-user-pool-client");
    expect(script).toContain("aws cognito-idp create-user-pool-client");
    expect(script).toContain("--generate-secret");
    expect(script).toContain(".AllowedOAuthFlows");
    expect(script).toContain(".AllowedOAuthScopes");
  });

  test("writes the replacement client's id+secret to the given secret, never logs the secret itself in the step's final outcome line", () => {
    const script = cognitoCreateReplacementClientScript(opts);
    expect(script).toContain(`--secret-id "${opts.replacementSecretName}"`);
    const outcomeLine = script.split("\n").at(-1) as string;
    expect(outcomeLine).toContain("$OLD_CLIENT_ID");
    expect(outcomeLine).toContain("$NEW_CLIENT_ID");
    expect(outcomeLine).not.toContain("NEW_CLIENT_SECRET");
  });

  test("deleting the outgoing client is idempotent (already-gone is a clean no-op, not a failure)", () => {
    const script = cognitoDeleteOldClientScript({ userPoolName: opts.userPoolName, oldClientName: opts.oldClientName });
    expect(script).toContain("aws cognito-idp delete-user-pool-client");
    expect(script).toContain("exit 0");
  });
});

describe("RDS credential rotation — tier-appropriate mechanism (chant#890)", () => {
  test("production-ha triggers the native Secrets Manager rotation already wired by loom-db's RotationSchedule", () => {
    const script = rdsRotateNativeScript("loom-prod-a-loom-db-credentials");
    expect(script).toBe(
      [
        "set -euo pipefail",
        `aws secretsmanager rotate-secret --secret-id "loom-prod-a-loom-db-credentials"`,
        `aws secretsmanager wait secret-exists --secret-id "loom-prod-a-loom-db-credentials"`,
        `echo "rds-rotate: triggered native rotation for loom-prod-a-loom-db-credentials"`,
      ].join("\n"),
    );
  });

  test("production/light manually rotate the master password and rewrite both secrets", () => {
    const script = rdsRotateManualScript({
      dbInstanceIdentifier: "loom-prod-a-loom-db-instance",
      credentialsSecretName: "loom-prod-a-loom-db-credentials",
      connectionSecretName: "loom-prod-a-loom-db-database-url",
      dbUsername: "loom",
      dbName: "loom",
      rdsProxyName: "loom-prod-a-loom-db-proxy",
    });
    expect(script).toContain("aws secretsmanager get-random-password");
    expect(script).toContain("aws rds modify-db-instance");
    expect(script).toContain("--apply-immediately");
    expect(script).toContain('aws secretsmanager put-secret-value --secret-id "loom-prod-a-loom-db-credentials"');
    expect(script).toContain('aws secretsmanager put-secret-value --secret-id "loom-prod-a-loom-db-database-url"');
  });

  test("resolves the connection endpoint from the RDS Proxy when one exists (production)", () => {
    const script = rdsRotateManualScript({
      dbInstanceIdentifier: "id",
      credentialsSecretName: "creds",
      connectionSecretName: "conn",
      dbUsername: "loom",
      dbName: "loom",
      rdsProxyName: "loom-prod-a-loom-db-proxy",
    });
    expect(script).toContain('aws rds describe-db-proxies --db-proxy-name "loom-prod-a-loom-db-proxy"');
  });

  test("falls back to the DB instance's own endpoint when no proxy exists (light)", () => {
    const script = rdsRotateManualScript({
      dbInstanceIdentifier: "loom-dev-a-loom-db-instance",
      credentialsSecretName: "creds",
      connectionSecretName: "conn",
      dbUsername: "loom",
      dbName: "loom",
    });
    expect(script).toContain('aws rds describe-db-instances --db-instance-identifier "loom-dev-a-loom-db-instance"');
    expect(script).not.toContain("describe-db-proxies");
  });
});

describe("ACM certificate rotation (chant#905 — request/validate, then a separate gated swap)", () => {
  test("requests a new cert and self-validates via Route53, looked up by domain (no opaque zone id required as input)", () => {
    const script = acmRequestScript({ domainName: "loom.example.com" });
    expect(script).toContain('aws route53 list-hosted-zones-by-name --dns-name "loom.example.com."');
    expect(script).toContain("aws acm request-certificate");
    expect(script).toContain("--validation-method DNS");
    expect(script).toContain("aws route53 change-resource-record-sets");
    expect(script).toContain("aws acm wait certificate-validated");
  });

  test("does not touch the ALB listener — that is acmSwapListenerScript's job", () => {
    const script = acmRequestScript({ domainName: "loom.example.com" });
    expect(script).not.toContain("modify-listener");
  });

  test("swaps the listener onto the newest ISSUED cert, resolving the ALB/listener ARNs by the deterministic ALB name", () => {
    const script = acmSwapListenerScript({ albName: "loom-prod-a-shared-foundation-alb", domainName: "loom.example.com" });
    expect(script).toContain('aws elbv2 describe-load-balancers --names "loom-prod-a-shared-foundation-alb"');
    expect(script).toContain("Listeners[?Port==`443`]");
    expect(script).toContain("aws elbv2 modify-listener");
  });
});
