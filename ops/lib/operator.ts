/**
 * Loom's operator make targets as Op scripts (loomster#39). Pure,
 * unit-testable bash builders, same shape as `./restore.ts` and
 * `./backend-scripts.ts`; the Ops in `../loom-*.op.ts` wrap them.
 *
 * Upstream reads every input from `etc/environment.sh` (`P_MEMORY_ID`,
 * `O_COGNITO_USER_POOL_ID`, `LOOM_DATABASE_URL` on the operator's laptop, ...).
 * Here an input is either derived from the naming helper (`./stack-refs.ts`),
 * read from a stack output at run time, or, when only the operator knows it
 * (a memory id, a SQLite file), a run-time env var named in the Op's
 * overview. Anything that needs the database runs inside the VPC as a one-off
 * task of the live backend (`./backend-scripts.ts`), with the backend's own
 * `LOOM_DATABASE_URL`, so no database credential ever reaches the operator's
 * shell or the task's command line.
 */

import type { LoomNamingParams } from "../../src/lib/naming";
import { backendTaskPrelude, runBackendCommandScript, shq, type BackendTaskTarget } from "./backend-scripts";
import { stackRefs } from "./stack-refs";

/** Container name in the backend task definition (`../../src/composites/loom-backend.ts`). */
export const BACKEND_CONTAINER = "backend";

export interface OperatorRefs {
  /** The live backend service, for one-off tasks. */
  backend: BackendTaskTarget;
  /** RDS instance the destructive Ops snapshot first. */
  dbInstanceIdentifier: string;
  sharedFoundationStackName: string;
  cognitoStackName: string;
}

/** Everything the operator Ops resolve, from one naming-params source. */
export function operatorRefs(naming: LoomNamingParams): OperatorRefs {
  const refs = stackRefs(naming);
  // CFN stack names are namespaced by project+env+instance (loomster#140).
  const stack = (component: string): string => `${naming.project}-${naming.env}-${naming.instance}-${component}`;
  return {
    backend: { cluster: refs.ecsClusterName, serviceName: refs.backendServiceName, container: BACKEND_CONTAINER },
    dbInstanceIdentifier: refs.dbInstanceIdentifier,
    sharedFoundationStackName: stack("shared-foundation"),
    cognitoStackName: stack("loom-cognito"),
  };
}

/** `aws cloudformation describe-stacks` for one output value, `None`/missing as empty. */
function stackOutputLine(variable: string, stackName: string, key: string): string {
  return `${variable}=$(aws cloudformation describe-stacks --stack-name "${stackName}" --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" --output text 2>/dev/null || true); [ "$${variable}" != "None" ] || ${variable}=""`;
}

// ── make migrate (migrate-db + fix-sequences) ───────────────────────────────

/**
 * `make fix-sequences`: reset every Postgres id sequence to its table's max
 * id (`backend/scripts/fix_sequences.py`). Needed after rows are copied in
 * with explicit ids (the SQLite import below does it itself). Idempotent.
 */
export function fixSequencesScript(target: BackendTaskTarget): string {
  return runBackendCommandScript(target, {
    tag: "fix-sequences",
    label: "fix_sequences",
    command: ["python", "-m", "scripts.fix_sequences"],
  });
}

export interface ImportSqliteRefs {
  target: BackendTaskTarget;
  /** shared-foundation stack, for its `oArtifactBucket` output (the backend task role can read it). */
  sharedFoundationStackName: string;
}

/**
 * `make migrate` (`migrate-db` + `fix-sequences`): copy a SQLite Loom
 * (`LOOM_IMPORT_SQLITE`, a local path, e.g. a laptop's `backend/loom.db`) into
 * this deployment's Postgres. The file goes to the artifact bucket under
 * `loom-import/<ts>/`, a one-off backend task downloads it to `/tmp`, runs
 * `migrate_sqlite_to_postgres.py --dest "$LOOM_DATABASE_URL"` (the URL expands
 * inside the container) and then `fix_sequences.py`; the object is deleted on
 * exit either way. Like upstream, each copied table's existing rows are
 * replaced; `LOOM_IMPORT_SKIP_EXISTING=1` skips tables that already have data.
 */
export function importSqliteScript(refs: ImportSqliteRefs): string {
  const { target } = refs;
  const inner = [
    `python -c "import boto3, sys; boto3.client('s3').download_file(sys.argv[1], sys.argv[2], '/tmp/loom.db')" "$0" "$1"`,
    `python -m scripts.migrate_sqlite_to_postgres --source sqlite:////tmp/loom.db --dest "$LOOM_DATABASE_URL" $2`,
    `python -m scripts.fix_sequences`,
  ].join(" && ");
  return [
    "set -euo pipefail",
    `SRC="\${LOOM_IMPORT_SQLITE:-}"`,
    `if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then echo "import-sqlite: set LOOM_IMPORT_SQLITE to the SQLite file to import (got '$SRC')" >&2; exit 1; fi`,
    `SKIP=""; [ "\${LOOM_IMPORT_SKIP_EXISTING:-}" != 1 ] || SKIP="--skip-existing"`,
    stackOutputLine("BUCKET", refs.sharedFoundationStackName, "oArtifactBucket"),
    `if [ -z "$BUCKET" ]; then echo "import-sqlite: no oArtifactBucket output on ${refs.sharedFoundationStackName}" >&2; exit 1; fi`,
    ...backendTaskPrelude(target, "import-sqlite"),
    `KEY="loom-import/$(date -u +%Y%m%dT%H%M%SZ)/loom.db"`,
    `aws s3 cp "$SRC" "s3://$BUCKET/$KEY" >/dev/null`,
    `trap 'aws s3 rm "s3://$BUCKET/$KEY" >/dev/null 2>&1 || echo "import-sqlite: could not delete s3://$BUCKET/$KEY" >&2' EXIT`,
    `echo "import-sqlite: uploaded $SRC to s3://$BUCKET/$KEY; importing on $TASK_DEF"`,
    `OVERRIDES=$(jq -cn --arg c "${target.container}" --arg cmd ${shq(inner)} --arg b "$BUCKET" --arg k "$KEY" --arg s "$SKIP" '{containerOverrides:[{name:$c,command:["sh","-c",$cmd,$b,$k,$s]}]}')`,
    `run_backend_task migrate_sqlite_to_postgres "$OVERRIDES"`,
  ].join("\n");
}

// ── make reset-db ───────────────────────────────────────────────────────────

/**
 * Python for `make reset-db` (`backend/scripts/reset_db.py`) without its two
 * problems in a one-off task: the script prompts for "yes" on stdin (a task
 * has none; the Op's approval gate is the confirmation) and prints the full
 * `LOOM_DATABASE_URL`, password included, into the logs.
 */
export const RESET_DB_PY = [
  "import os, sys",
  "from sqlalchemy import create_engine, text",
  "url = os.environ.get('LOOM_DATABASE_URL', '')",
  "if not url or url.startswith('sqlite'):",
  "    sys.exit('reset-db: LOOM_DATABASE_URL is not a PostgreSQL URL')",
  "with create_engine(url).begin() as conn:",
  "    conn.execute(text('DROP SCHEMA public CASCADE'))",
  "    conn.execute(text('CREATE SCHEMA public'))",
  "print('reset-db: public schema dropped and recreated')",
].join("\n");

/** Drop and recreate the `public` schema, as a one-off backend task. */
export function resetDbScript(target: BackendTaskTarget): string {
  return runBackendCommandScript(target, { tag: "reset-db", label: "reset_db", command: ["python", "-c", RESET_DB_PY] });
}

/**
 * Roll the backend so new tasks run `init_db()` (create_all, default tags)
 * against the empty schema, and wait for it to settle.
 */
export function restartBackendScript(target: BackendTaskTarget): string {
  return [
    "set -euo pipefail",
    `aws ecs update-service --cluster "${target.cluster}" --service "${target.serviceName}" --force-new-deployment >/dev/null`,
    `aws ecs wait services-stable --cluster "${target.cluster}" --services "${target.serviceName}"`,
    `echo "reset-db: ${target.serviceName} rolled; the schema is recreated, run loom-seed to repopulate it"`,
  ].join("\n");
}

// ── make agentcore.credentials.* ────────────────────────────────────────────

/**
 * `make agentcore.credentials.list`: every OAuth2 and API-key credential
 * provider in the region (read-only, account-wide like upstream). Loom names
 * its own `loom-<agent>-<agent id>-<kind>[-<resource>]`.
 */
export function listCredentialProvidersScript(): string {
  return [
    "set -euo pipefail",
    `echo "OAuth2 credential providers:"`,
    `aws bedrock-agentcore-control list-oauth2-credential-providers --output json | jq -r '.credentialProviders[]? | "  \\(.name)\\t\\(.credentialProviderVendor // "-")\\t\\(.createdTime // "-")"'`,
    `echo "API-key credential providers:"`,
    `aws bedrock-agentcore-control list-api-key-credential-providers --output json | jq -r '.credentialProviders[]? | "  \\(.name)\\t\\(.createdTime // "-")"'`,
  ].join("\n");
}

/**
 * Python run inside the backend (argv[1] = `list` or `delete`): the credential
 * providers THIS Loom recorded, read from its own database, the same sources
 * Loom's agent delete cleans up (`routers/agents.py` delete_agent): the
 * `credential_providers` table, each agent's `AGENT_CONFIG_JSON`
 * mcp_servers/a2a_agents `auth.credential_provider_name`, and its LiteLLM
 * API-key provider. Upstream's `delete-all` deletes every provider in the
 * account; provider names carry no deployment marker, so that would reach
 * other Loom instances' providers. This never does.
 */
export const OWNED_CREDENTIAL_PROVIDERS_PY = [
  "import json, sys",
  "import app.models",
  "from app.db import SessionLocal",
  "from app.models import Agent, CredentialProvider",
  "from app.services.credential import delete_credential_provider, delete_api_key_credential_provider",
  "mode = sys.argv[1] if len(sys.argv) > 1 else 'list'",
  "owned = {}",
  "db = SessionLocal()",
  "try:",
  "    for agent in db.query(Agent).all():",
  "        for cp in agent.credential_providers:",
  "            owned[cp.name] = ('oauth2', agent.region)",
  "        cfg = {e.key: e.value for e in agent.config_entries}.get('AGENT_CONFIG_JSON')",
  "        try:",
  "            cfg = json.loads(cfg) if cfg else {}",
  "        except (ValueError, TypeError):",
  "            cfg = {}",
  "        integrations = cfg.get('integrations', {}) or {}",
  "        for item in (integrations.get('mcp_servers') or []) + (integrations.get('a2a_agents') or []):",
  "            name = (item.get('auth') or {}).get('credential_provider_name')",
  "            if name:",
  "                owned[name] = ('oauth2', agent.region)",
  "        if cfg.get('litellm_api_key_credential_provider_name'):",
  "            owned[cfg['litellm_api_key_credential_provider_name']] = ('apikey', agent.region)",
  "    for cp in db.query(CredentialProvider).all():",
  "        owned.setdefault(cp.name, ('oauth2', cp.agent.region if cp.agent else None))",
  "finally:",
  "    db.close()",
  "print(f'credentials: {len(owned)} provider(s) recorded by this Loom')",
  "failed = 0",
  "for name, (kind, region) in sorted(owned.items()):",
  "    if mode != 'delete':",
  "        print(f'  {kind}\\t{region}\\t{name}')",
  "        continue",
  "    try:",
  "        (delete_api_key_credential_provider if kind == 'apikey' else delete_credential_provider)(name, region)",
  "        print(f'  deleted {kind} {name} ({region})')",
  "    except Exception as e:",
  "        if 'ResourceNotFound' in type(e).__name__ or 'ResourceNotFound' in str(e):",
  "            print(f'  already gone: {name}')",
  "        else:",
  "            failed += 1",
  "            print(f'  FAILED {name}: {e}')",
  "sys.exit(1 if failed else 0)",
].join("\n");

/**
 * List or delete the credential providers this Loom recorded, as a one-off
 * backend task. With `missingServiceOk` (teardown re-run after the backend is
 * gone) a missing service is not a failure.
 */
export function ownedCredentialProvidersScript(target: BackendTaskTarget, mode: "list" | "delete", opts: { missingServiceOk?: boolean } = {}): string {
  return runBackendCommandScript(target, {
    tag: `credentials-${mode}`,
    label: `credential providers (${mode})`,
    command: ["python", "-c", OWNED_CREDENTIAL_PROVIDERS_PY, mode],
    missingServiceOk: opts.missingServiceOk,
  });
}

// ── make agentcore.memory.* ─────────────────────────────────────────────────

/** The `LOOM_MEMORY_QUERY` values, one per upstream `agentcore.memory.*` target. */
export const MEMORY_QUERIES = ["list", "get", "records", "records-by-namespace", "extraction-jobs"] as const;

/**
 * `make agentcore.memory.{list,get,records,records-by-namespace,extraction-jobs}`,
 * read-only, with the AWS CLI instead of upstream's Python helpers (no venv on
 * the operator's machine). `LOOM_MEMORY_QUERY` picks one (default `list`);
 * `LOOM_MEMORY_ID`, `LOOM_MEMORY_ACTOR_ID` and `LOOM_MEMORY_NAMESPACE` are
 * upstream's `P_MEMORY_ID`, `P_MEMORY_ACTOR_ID` and `P_MEMORY_NAMESPACE`.
 * `records` expands each strategy's namespace templates for the actor and
 * cuts them at the first unfilled `{...}`, as `query_memory_records.py` does.
 */
export function memoryQueryScript(): string {
  return [
    "set -euo pipefail",
    `Q="\${LOOM_MEMORY_QUERY:-list}"`,
    `need() { [ -n "\${!1:-}" ] || { echo "memory: LOOM_MEMORY_QUERY=$Q needs $1" >&2; exit 1; }; }`,
    `case "$Q" in`,
    `  list) aws bedrock-agentcore-control list-memories --output json | jq '.memories' ;;`,
    `  get) need LOOM_MEMORY_ID; aws bedrock-agentcore-control get-memory --memory-id "$LOOM_MEMORY_ID" --output json | jq '.memory' ;;`,
    `  records)`,
    `    need LOOM_MEMORY_ID; need LOOM_MEMORY_ACTOR_ID`,
    `    NAMESPACES=$(aws bedrock-agentcore-control get-memory --memory-id "$LOOM_MEMORY_ID" --output json | jq -r --arg a "$LOOM_MEMORY_ACTOR_ID" '`,
    `      .memory.strategies[]? | (if has("strategyId") then . else ([.[] | objects | select(has("strategyId"))][0] // {}) end)`,
    `      | .strategyId as $s | (.namespaces // [])[] | gsub("\\\\{memoryStrategyId\\\\}"; $s) | gsub("\\\\{actorId\\\\}"; $a) | sub("\\\\{.*$"; "")')`,
    `    RECORDS='[]'`,
    `    while IFS= read -r NS; do`,
    `      [ -n "$NS" ] || continue`,
    `      PAGE=$(aws bedrock-agentcore list-memory-records --memory-id "$LOOM_MEMORY_ID" --namespace "$NS" --output json | jq '.memoryRecordSummaries // .memoryRecords // []')`,
    `      RECORDS=$(jq -c --argjson p "$PAGE" '. + $p' <<<"$RECORDS")`,
    `    done <<<"$NAMESPACES"`,
    `    jq -n --arg a "$LOOM_MEMORY_ACTOR_ID" --arg m "$LOOM_MEMORY_ID" --argjson r "$RECORDS" '{actor_id: $a, memory_id: $m, total_records: ($r | length), records: $r}' ;;`,
    `  records-by-namespace)`,
    `    need LOOM_MEMORY_ID; need LOOM_MEMORY_NAMESPACE`,
    `    aws bedrock-agentcore list-memory-records --memory-id "$LOOM_MEMORY_ID" --namespace "$LOOM_MEMORY_NAMESPACE" --output json | jq '.memoryRecordSummaries // .memoryRecords // []' ;;`,
    `  extraction-jobs)`,
    `    need LOOM_MEMORY_ID`,
    `    aws bedrock-agentcore list-memory-extraction-jobs --memory-id "$LOOM_MEMORY_ID" --max-results 10 --output json | jq '.jobs // .memoryExtractionJobs // []' ;;`,
    `  *) echo "memory: LOOM_MEMORY_QUERY must be one of ${MEMORY_QUERIES.join(", ")} (got '$Q')" >&2; exit 1 ;;`,
    `esac`,
  ].join("\n");
}

// ── make cognito.set-passwords ──────────────────────────────────────────────

/**
 * `make cognito.set-passwords`: set a permanent password for first sign-in.
 * Upstream hard-codes its 22 demo users; here `LOOM_COGNITO_USERS`
 * (comma-separated) names them, and unset means every user still in
 * FORCE_CHANGE_PASSWORD. The password comes from `LOOM_COGNITO_PASSWORD` and
 * reaches the AWS CLI through a 0600 temp file (`--cli-input-json`), never
 * argv, so it does not show in `ps`.
 */
export function setPasswordsScript(cognitoStackName: string): string {
  return [
    "set -euo pipefail",
    `[ -n "\${LOOM_COGNITO_PASSWORD:-}" ] || { echo "set-passwords: set LOOM_COGNITO_PASSWORD" >&2; exit 1; }`,
    stackOutputLine("POOL", cognitoStackName, "oCognitoUserPoolId"),
    `if [ -z "$POOL" ]; then echo "set-passwords: no oCognitoUserPoolId output on ${cognitoStackName}" >&2; exit 1; fi`,
    `if [ -n "\${LOOM_COGNITO_USERS:-}" ]; then USERS=$(tr ',' '\\n' <<<"$LOOM_COGNITO_USERS" | sed 's/^ *//; s/ *$//' | grep -v '^$' || true)`,
    `else USERS=$(aws cognito-idp list-users --user-pool-id "$POOL" --filter 'cognito:user_status = "FORCE_CHANGE_PASSWORD"' --output json | jq -r '.Users[].Username'); fi`,
    `if [ -z "$USERS" ]; then echo "set-passwords: no users to set (none in FORCE_CHANGE_PASSWORD; name them with LOOM_COGNITO_USERS)"; exit 0; fi`,
    `INPUT=$(umask 077; mktemp "\${TMPDIR:-/tmp}/loom-set-password.XXXXXX")`,
    `trap 'rm -f "$INPUT"' EXIT`,
    `while IFS= read -r U; do`,
    `  jq -cn --arg p "$POOL" --arg u "$U" --arg pw "$LOOM_COGNITO_PASSWORD" '{UserPoolId: $p, Username: $u, Password: $pw, Permanent: true}' >"$INPUT"`,
    `  aws cognito-idp admin-set-user-password --cli-input-json "file://$INPUT"`,
    `  echo "set-passwords: $U"`,
    `done <<<"$USERS"`,
  ].join("\n");
}
