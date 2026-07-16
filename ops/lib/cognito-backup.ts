/**
 * Cognito user-pool export script. The pool's *configuration* (groups, clients,
 * resource server, scopes) is in code and comes back with a re-synth, but the
 * *user records* are not — a pool loss loses users. This exports them.
 *
 * Same pattern as `./backup.ts` / `./rds-safety.ts`: a pure, unit-testable AWS
 * CLI script builder. The deterministic pool *name* is baked in at build time
 * (from `./stack-refs.ts`); the AWS-generated pool *id* is resolved by that
 * name at run time (the same indirection `./rotation.ts` uses), then users,
 * groups, and per-group memberships are collected and emitted as one JSON
 * document — to stdout, and to S3 when `LOOM_BACKUP_BUCKET` is set.
 *
 * Read-only and additive, so `../loom-cognito-export.op.ts` runs on the local
 * executor with no gate.
 */

export interface CognitoExportRefs {
  /** Deterministic Cognito user-pool name (`./stack-refs.ts`'s `cognitoUserPoolName`). */
  cognitoUserPoolName: string;
}

export function cognitoUserExportScript(refs: CognitoExportRefs): string {
  const poolName = refs.cognitoUserPoolName;
  return [
    "set -euo pipefail",
    `POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='${poolName}'].Id | [0]" --output text)`,
    `if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then echo "cognito-export: no user pool named ${poolName}" >&2; exit 1; fi`,
    // The AWS CLI auto-paginates list-users / list-groups (follows NextToken)
    // unless --max-items is given, so a single call returns the full set.
    `USERS=$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --output json)`,
    `GROUPS=$(aws cognito-idp list-groups --user-pool-id "$POOL_ID" --output json)`,
    `MEMBERSHIPS="{}"`,
    `for GROUP in $(echo "$GROUPS" | jq -r ".Groups[].GroupName"); do`,
    `  MEMBERS=$(aws cognito-idp list-users-in-group --user-pool-id "$POOL_ID" --group-name "$GROUP" --query "Users[].Username" --output json)`,
    `  MEMBERSHIPS=$(echo "$MEMBERSHIPS" | jq --arg g "$GROUP" --argjson m "$MEMBERS" '. + {($g): $m}')`,
    `done`,
    `EXPORT=$(jq -n --argjson users "$USERS" --argjson groups "$GROUPS" --argjson memberships "$MEMBERSHIPS" '{poolName: "${poolName}", exportedAt: (now | todate), users: $users.Users, groups: $groups.Groups, memberships: $memberships}')`,
    `echo "$EXPORT"`,
    `if [ -n "\${LOOM_BACKUP_BUCKET:-}" ]; then`,
    `  KEY="cognito-backups/${poolName}-users-$(date -u +%Y%m%dt%H%M%Sz).json"`,
    `  echo "$EXPORT" | aws s3 cp - "s3://$LOOM_BACKUP_BUCKET/$KEY"`,
    `  echo "cognito-export: wrote s3://$LOOM_BACKUP_BUCKET/$KEY" >&2`,
    `fi`,
  ].join("\n");
}
