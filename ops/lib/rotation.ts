/**
 * Rotation scripts (chant#905) — Cognito M2M app-client secret, RDS master
 * credentials, and the ALB's ACM certificate. Same `shell()`-script approach
 * `../lib/rds-safety.ts` documents in full: no Op-level activity exists for any
 * of these three verbs, so each function below is a pure, unit-tested AWS CLI
 * script builder, run via a `shell()` step.
 *
 * Assumes `jq` alongside the `aws` CLI on whatever host/worker image runs these
 * steps — both scripts below need to read one field out of a prior AWS CLI
 * call's JSON and feed it into the next, which is exactly the "run-time value
 * flowing between commands within one step" case `../lib/rds-safety.ts`'s
 * docstring explains (`ActivityStep.args` are static, so this can only happen
 * *inside* one script, in ordinary shell — never across two Op steps).
 */

// ── Cognito M2M app-client (blue/green — no in-place "regenerate secret" API) ─

/**
 * Cognito has no API to rotate an existing app client's secret in place
 * (`UpdateUserPoolClient` does not touch it, and there is no
 * "regenerate secret" call) — the only way to get a new secret is a new
 * client. This creates one, copying the outgoing client's OAuth flow/scope
 * configuration exactly (read via `describe-user-pool-client`, not
 * re-guessed), and writes `{clientId, clientSecret}` into a dedicated Secrets
 * Manager secret so downstream consumers can be repointed before the gate
 * below deletes the old client.
 *
 * `userPoolName`/`oldClientName` are the deterministic names
 * `../lib/stack-refs.ts` derives (`loomNaming`) — the user pool id and the
 * outgoing client id are both AWS-generated and opaque, so both are resolved
 * by that name at run time, never hardcoded.
 */
export function cognitoCreateReplacementClientScript(opts: {
  userPoolName: string;
  oldClientName: string;
  replacementSecretName: string;
}): string {
  const { userPoolName, oldClientName, replacementSecretName } = opts;
  return [
    "set -euo pipefail",
    `POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='${userPoolName}'].Id | [0]" --output text)`,
    `if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then echo "cognito-rotate: no user pool named ${userPoolName}" >&2; exit 1; fi`,
    `OLD_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 60 --query "UserPoolClients[?ClientName=='${oldClientName}'].ClientId | [0]" --output text)`,
    `if [ -z "$OLD_CLIENT_ID" ] || [ "$OLD_CLIENT_ID" = "None" ]; then echo "cognito-rotate: no client named ${oldClientName}" >&2; exit 1; fi`,
    `OLD_CLIENT=$(aws cognito-idp describe-user-pool-client --user-pool-id "$POOL_ID" --client-id "$OLD_CLIENT_ID" --query "UserPoolClient")`,
    `NEW_CLIENT_NAME="${oldClientName}-$(date -u +%Y%m%dt%H%M%Sz)"`,
    `ALLOWED_FLOWS=$(echo "$OLD_CLIENT" | jq -c '.AllowedOAuthFlows')`,
    `ALLOWED_SCOPES=$(echo "$OLD_CLIENT" | jq -c '.AllowedOAuthScopes')`,
    `NEW_CLIENT=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" --client-name "$NEW_CLIENT_NAME" --generate-secret --allowed-o-auth-flows-user-pool-client --allowed-o-auth-flows "$ALLOWED_FLOWS" --allowed-o-auth-scopes "$ALLOWED_SCOPES" --output json)`,
    `NEW_CLIENT_ID=$(echo "$NEW_CLIENT" | jq -r '.UserPoolClient.ClientId')`,
    `NEW_CLIENT_SECRET=$(echo "$NEW_CLIENT" | jq -r '.UserPoolClient.ClientSecret')`,
    `SECRET_STRING=$(jq -nc --arg id "$NEW_CLIENT_ID" --arg secret "$NEW_CLIENT_SECRET" '{clientId:$id,clientSecret:$secret}')`,
    `aws secretsmanager put-secret-value --secret-id "${replacementSecretName}" --secret-string "$SECRET_STRING" 2>/dev/null || aws secretsmanager create-secret --name "${replacementSecretName}" --secret-string "$SECRET_STRING"`,
    `echo "{\\"oldClientId\\":\\"$OLD_CLIENT_ID\\",\\"newClientId\\":\\"$NEW_CLIENT_ID\\"}"`,
  ].join("\n");
}

/**
 * The disruptive half of the rotation — deletes the outgoing app client,
 * invalidating its secret for any caller that has not yet switched to the
 * replacement `cognitoCreateReplacementClientScript` wrote out. Placed after
 * the Op's approval gate for exactly that reason (chant#905: "Gate where a
 * rotation is disruptive").
 */
export function cognitoDeleteOldClientScript(opts: { userPoolName: string; oldClientName: string }): string {
  const { userPoolName, oldClientName } = opts;
  return [
    "set -euo pipefail",
    `POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='${userPoolName}'].Id | [0]" --output text)`,
    `OLD_CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 60 --query "UserPoolClients[?ClientName=='${oldClientName}'].ClientId | [0]" --output text)`,
    `if [ -z "$OLD_CLIENT_ID" ] || [ "$OLD_CLIENT_ID" = "None" ]; then echo "cognito-rotate: ${oldClientName} already gone — nothing to delete"; exit 0; fi`,
    `aws cognito-idp delete-user-pool-client --user-pool-id "$POOL_ID" --client-id "$OLD_CLIENT_ID"`,
    `echo "cognito-rotate: deleted outgoing client $OLD_CLIENT_ID"`,
  ].join("\n");
}

// ── RDS secret rotation ───────────────────────────────────────────────────────

/**
 * `production-ha` already has a `RotationSchedule` + hosted rotation Lambda
 * wired by `../../src/composites/loom-db.ts`'s `buildRotation` — this simply
 * triggers it on demand (instead of waiting for the 30-day schedule) via the
 * same Secrets Manager rotation the CFN resource already attached.
 */
export function rdsRotateNativeScript(credentialsSecretName: string): string {
  return [
    "set -euo pipefail",
    `aws secretsmanager rotate-secret --secret-id "${credentialsSecretName}"`,
    `aws secretsmanager wait secret-exists --secret-id "${credentialsSecretName}"`,
    `echo "rds-rotate: triggered native rotation for ${credentialsSecretName}"`,
  ].join("\n");
}

/**
 * `light`/`production` provision no rotation Lambda (chant#890 tier gating —
 * `RotationSchedule` is production-ha only), so there is nothing to trigger.
 * Rotating the credential there means generating a new password, applying it
 * to the live instance, and writing both secrets — one script, run-time values
 * never leaving it (same reasoning as `../lib/rds-safety.ts`).
 */
export function rdsRotateManualScript(opts: {
  dbInstanceIdentifier: string;
  credentialsSecretName: string;
  connectionSecretName: string;
  dbUsername: string;
  dbName: string;
  /** RDS Proxy name (production has one; light does not — see `../../src/composites/loom-db.ts`'s tier gating). When given, the connection secret is rebuilt against the proxy's endpoint (looked up at run time — a proxy endpoint is AWS-generated, never naming-deterministic); when omitted, against the DB instance's own endpoint. */
  rdsProxyName?: string;
}): string {
  const { dbInstanceIdentifier, credentialsSecretName, connectionSecretName, dbUsername, dbName, rdsProxyName } = opts;
  const resolveEndpoint = rdsProxyName
    ? `CONNECT_ENDPOINT=$(aws rds describe-db-proxies --db-proxy-name "${rdsProxyName}" --query "DBProxies[0].Endpoint" --output text)`
    : `CONNECT_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${dbInstanceIdentifier}" --query "DBInstances[0].Endpoint.Address" --output text)`;
  return [
    "set -euo pipefail",
    `NEW_PASSWORD=$(aws secretsmanager get-random-password --exclude-punctuation --password-length 32 --query RandomPassword --output text)`,
    `aws rds modify-db-instance --db-instance-identifier "${dbInstanceIdentifier}" --master-user-password "$NEW_PASSWORD" --apply-immediately`,
    `aws rds wait db-instance-available --db-instance-identifier "${dbInstanceIdentifier}"`,
    `CREDENTIALS_JSON=$(jq -nc --arg u "${dbUsername}" --arg p "$NEW_PASSWORD" '{username:$u,password:$p}')`,
    `aws secretsmanager put-secret-value --secret-id "${credentialsSecretName}" --secret-string "$CREDENTIALS_JSON"`,
    resolveEndpoint,
    `CONNECTION_URL="postgresql+psycopg2://${dbUsername}:$NEW_PASSWORD@$CONNECT_ENDPOINT:5432/${dbName}"`,
    `CONNECTION_JSON=$(jq -nc --arg url "$CONNECTION_URL" '{url:$url}')`,
    `aws secretsmanager put-secret-value --secret-id "${connectionSecretName}" --secret-string "$CONNECTION_JSON"`,
    `echo "rds-rotate: master password rotated for ${dbInstanceIdentifier}"`,
  ].join("\n");
}

// ── ACM certificate rotation ─────────────────────────────────────────────────

/**
 * Requests a fresh ACM certificate for `domainName` (DNS validation, in the
 * Route53 hosted zone `../../src/composites/shared-foundation.ts` already
 * manages when the `route53` seam is `provision` — looked up by domain name,
 * the one Route53-side identifier that is not AWS-generated) and waits for it
 * to reach `ISSUED`. Deliberately does not touch the ALB listener yet —
 * swapping the listener's certificate is `acmSwapListenerScript`, a separate
 * step so the new cert is proven valid before anything live points at it.
 */
export function acmRequestScript(opts: { domainName: string }): string {
  const { domainName } = opts;
  const zoneName = domainName.endsWith(".") ? domainName : `${domainName}.`;
  return [
    "set -euo pipefail",
    `HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "${zoneName}" --max-items 1 --query "HostedZones[0].Id" --output text | sed 's#/hostedzone/##')`,
    `if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" = "None" ]; then echo "acm-rotate: no hosted zone found for ${domainName}" >&2; exit 1; fi`,
    `NEW_CERT_ARN=$(aws acm request-certificate --domain-name "${domainName}" --validation-method DNS --query CertificateArn --output text)`,
    `RECORD="null"`,
    `for i in $(seq 1 30); do`,
    `  RECORD=$(aws acm describe-certificate --certificate-arn "$NEW_CERT_ARN" --query "Certificate.DomainValidationOptions[0].ResourceRecord" --output json)`,
    `  [ "$RECORD" != "null" ] && break`,
    `  sleep 10`,
    `done`,
    `if [ "$RECORD" = "null" ]; then echo "acm-rotate: validation record never appeared for $NEW_CERT_ARN" >&2; exit 1; fi`,
    `RR_NAME=$(echo "$RECORD" | jq -r '.Name')`,
    `RR_VALUE=$(echo "$RECORD" | jq -r '.Value')`,
    `CHANGE_BATCH=$(jq -nc --arg name "$RR_NAME" --arg value "$RR_VALUE" '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$name,Type:"CNAME",TTL:300,ResourceRecords:[{Value:$value}]}}]}')`,
    `aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "$CHANGE_BATCH"`,
    `aws acm wait certificate-validated --certificate-arn "$NEW_CERT_ARN"`,
    `echo "{\\"certificateArn\\":\\"$NEW_CERT_ARN\\"}"`,
  ].join("\n");
}

/**
 * Points the ALB's HTTPS listener at the newest `ISSUED` certificate for
 * `domainName` — run only after `acmRequestScript` reports `certificate-validated`,
 * and only after the approval gate (a live listener swap is exactly the kind of
 * disruptive step chant#905 asks for a gate ahead of). `albName` is the
 * deterministic name `../lib/stack-refs.ts` derives; the load balancer and
 * listener ARNs are both AWS-generated, so both are resolved from it at run
 * time rather than threaded through as opaque config.
 */
export function acmSwapListenerScript(opts: { albName: string; domainName: string }): string {
  const { albName, domainName } = opts;
  return [
    "set -euo pipefail",
    `ALB_ARN=$(aws elbv2 describe-load-balancers --names "${albName}" --query "LoadBalancers[0].LoadBalancerArn" --output text)`,
    `LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)`,
    `if [ -z "$LISTENER_ARN" ] || [ "$LISTENER_ARN" = "None" ]; then echo "acm-rotate: no port-443 listener found on ${albName}" >&2; exit 1; fi`,
    `NEW_CERT_ARN=$(aws acm list-certificates --certificate-statuses ISSUED --query "reverse(sort_by(CertificateSummaryList[?DomainName=='${domainName}'],&NotBefore))[0].CertificateArn" --output text)`,
    `if [ -z "$NEW_CERT_ARN" ] || [ "$NEW_CERT_ARN" = "None" ]; then echo "acm-rotate: no ISSUED certificate found for ${domainName}" >&2; exit 1; fi`,
    `aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" --certificates CertificateArn="$NEW_CERT_ARN"`,
    `echo "acm-rotate: listener now serving $NEW_CERT_ARN"`,
  ].join("\n");
}
