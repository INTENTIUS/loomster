#!/usr/bin/env bash
#
# Real-AWS support for the `aws` claims: a spend guard, a name prefix every
# deployment carries, and a cleanup that lists then deletes by that prefix.
#
#   test/claims-aws.sh guard              refuse unless a Budgets alert at or under
#                                         LOOM_CLAIMS_ALERT_USD (10) exists and the
#                                         month's spend is under LOOM_CLAIMS_SPEND_CAP_USD (25)
#   test/claims-aws.sh spend              the month's spend so far, from Cost Explorer
#   test/claims-aws.sh prefix             the prefix every stack and resource name carries
#   test/claims-aws.sh cleanup [--list]   list, then delete, everything carrying the prefix:
#                                         CloudFormation stacks (in teardown order),
#                                         AgentCore runtimes the claims created through
#                                         Loom, ECR repositories, S3 buckets and RDS
#                                         snapshots. --list only lists.
#
# test/claims.sh runs `guard` before any aws claim and `cleanup` after the aws
# claims (plain and BREAK), unless LOOM_CLAIMS_KEEP=1. Claims source this file
# and call claims_aws_env to export the naming the deploy uses.
#
# One deployment per run: every aws claim in a `just claims a,b,...` run shares
# the instance. A claim calls claims_aws_ensure <component>... and gets those
# components (and what they depend on, from `chant graph --components`) on top
# of whatever an earlier claim deployed; nothing is deployed twice, and the one
# cleanup at the end removes it all. claims_aws_token mints an admin's access
# token through the deployment's own user client.
#
# The ledger: chant writes a record to the repository's chant/lifecycle branch
# for every component release and Op run, and pushes it to origin. A claim's
# deploys and Op runs are tests, not this project's history, so claims_chant
# runs them against a scratch clone of the repository with no remote
# (GIT_DIR=<clone>, GIT_WORK_TREE=<this checkout>): the records land there and
# the cleanup deletes the clone.
#
# Names: an aws claim deploys with LOOM_ENV=claims and LOOM_INSTANCE set to the
# run's instance (LOOM_CLAIMS_INSTANCE, or one made once, c<5 hex>, kept in
# test/.state/claims-aws/instance until a cleanup leaves nothing behind), so
# every stack is "loom-claims-<instance>-<component>" and the prefix is
# "loom-claims-<instance>". Agents a claim deploys through Loom are named
# "loomster_claim_<instance>_*".
#
# Credentials and region are the AWS CLI's own (profile, SSO or exported keys;
# AWS_REGION, default us-east-1). Nothing here prints them.

CA_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_ROOT="$(cd "$CA_HERE/.." && pwd)"
CA_STATE="$CA_HERE/.state/claims-aws"
CA_ALERT_USD="${LOOM_CLAIMS_ALERT_USD:-10}"
CA_CAP_USD="${LOOM_CLAIMS_SPEND_CAP_USD:-25}"
# Cost Explorer bills $0.01 a request, so a passed guard is kept this long.
CA_GUARD_TTL="${LOOM_CLAIMS_GUARD_TTL:-1800}"
# The inline policy a BREAK run attaches to a role it denies; the cleanup
# removes it from every role of the prefix's stacks.
CLAIMS_BREAK_POLICY=loomster-claim-break
# Delete waves, "|" between waves: the component graph's deploy waves (`chant
# graph --components --json`), last wave first. A wave's stacks share no
# dependency, so the cleanup deletes them together and waits for the slowest
# instead of the sum. A component added later and missing here is still
# deleted by the sweep after the waves. The optional tunnel host (not a
# component, ops/loom-tunnel-host.op.ts) goes first: it sits on the network.
CA_STACK_WAVES="tunnel-host | loom-agents | loom-backend | downstream-stub loom-db loom-frontend | loom-cognito shared-foundation"

ca_log() { echo "[claims-aws] $*" >&2; }

# The claim's own log, kept on fd 9 when this file is sourced: a caller that
# sends a step's output to a file of its own (2>&1 >seed.log) would otherwise
# take the heartbeat with it, and the grant's stall watch, which watches the
# claim logs, would stop a healthy run.
exec 9>&2

ca() { AWS_PAGER="" aws --region "${AWS_REGION:-us-east-1}" --output json "$@" </dev/null; }

# Wait for a stack delete, logging its status every 30 s. A stack delete can run
# for many minutes (RDS, AgentCore ENIs) and `aws cloudformation wait` prints
# nothing, which the gate's stall watch reads as a hang and kills.
ca_wait_deleted() {
  local s="$1" st waited=0
  while :; do
    st="$(ca cloudformation describe-stacks --stack-name "$s" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo GONE)"
    case "$st" in
      GONE|DELETE_COMPLETE) return 0 ;;
      DELETE_FAILED) return 1 ;;
    esac
    [ "$waited" -lt 3600 ] || return 1
    ca_log "waiting for $s to delete ($st, ${waited}s)"
    sleep 30; waited=$((waited + 30))
  done
}
# Budgets and Cost Explorer answer in us-east-1 only.
ca_global() { AWS_PAGER="" aws --region us-east-1 --output json "$@" </dev/null; }

# ── the prefix ──────────────────────────────────────────────────────────────

# Sets CLAIMS_AWS_INSTANCE and CLAIMS_AWS_PREFIX.
claims_aws_prefix() {
  local inst="${LOOM_CLAIMS_INSTANCE:-}" file="$CA_STATE/instance" tmp
  if [ -z "$inst" ] && [ -s "$file" ]; then inst="$(cat "$file")"; fi
  if [ -z "$inst" ]; then
    mkdir -p "$CA_STATE"
    tmp="$file.$$"
    echo "c$(openssl rand -hex 3 | cut -c1-5)" > "$tmp"
    # Two runs that start together keep whichever instance was written first.
    if [ -s "$file" ]; then rm -f "$tmp"; else mv "$tmp" "$file"; fi
    inst="$(cat "$file")"
    ca_log "a new claims instance: $inst"
  fi
  [[ "$inst" =~ ^[a-z][a-z0-9]{1,7}$ ]] \
    || { ca_log "LOOM_CLAIMS_INSTANCE '$inst' is not 2 to 8 lower-case letters and digits, starting with a letter"; return 1; }
  CLAIMS_AWS_INSTANCE="$inst"
  CLAIMS_AWS_PREFIX="${LOOM_PROJECT:-loom}-claims-$inst"
}

# Exports the naming an aws claim deploys with.
claims_aws_env() {
  claims_aws_prefix || return 1
  export LOOM_ENV=claims LOOM_INSTANCE="$CLAIMS_AWS_INSTANCE" CLAIMS_AWS_PREFIX CLAIMS_AWS_INSTANCE
  export AWS_REGION="${AWS_REGION:-us-east-1}"
  export AWS_DEFAULT_REGION="$AWS_REGION"
}

# Why an aws claim cannot run here, or nothing when it can: the tools, the
# dependencies, a Docker daemon, credentials, and LOOM_CLAIMS_ACCOUNT_ID naming
# the account they resolve to, so a claim never deploys into an account by
# accident. Sets CLAIMS_AWS_ACCOUNT.
claims_aws_needs() { # [extra tool...]
  local tool acct
  for tool in aws jq curl docker python3 "$@"; do
    command -v "$tool" >/dev/null 2>&1 || { echo "needs $tool on PATH"; return; }
  done
  [ -x "$CA_ROOT/node_modules/.bin/chant" ] || { echo "node_modules/.bin/chant is missing: run npm ci"; return; }
  docker info >/dev/null 2>&1 || { echo "needs a running Docker daemon (the backend and frontend images build locally)"; return; }
  acct="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  [ -n "$acct" ] || { echo "AWS credentials do not resolve (aws sts get-caller-identity)"; return; }
  [ -n "${LOOM_CLAIMS_ACCOUNT_ID:-}" ] \
    || { echo "set LOOM_CLAIMS_ACCOUNT_ID to the account to deploy into (the credentials resolve to $acct)"; return; }
  [ "$LOOM_CLAIMS_ACCOUNT_ID" = "$acct" ] \
    || { echo "LOOM_CLAIMS_ACCOUNT_ID is $LOOM_CLAIMS_ACCOUNT_ID but the credentials resolve to $acct"; return; }
  CLAIMS_AWS_ACCOUNT="$acct"
}

# The naming plus everything the light tier deploys with: the tier, the
# account, the CPU architecture of this host, and one database password per
# claims instance (kept with the instance so a redeploy does not change it).
claims_aws_light_env() {
  claims_aws_env || return 1
  export LOOM_TIER=light AWS_ACCOUNT_ID="${CLAIMS_AWS_ACCOUNT:-${LOOM_CLAIMS_ACCOUNT_ID:-}}"
  if [ -z "${LOOM_CPU_ARCHITECTURE:-}" ]; then
    case "$(uname -m)" in arm64|aarch64) LOOM_CPU_ARCHITECTURE=ARM64 ;; *) LOOM_CPU_ARCHITECTURE=X86_64 ;; esac
  fi
  export LOOM_CPU_ARCHITECTURE
  local pwfile="$CA_STATE/db-password"
  if [ ! -s "$pwfile" ]; then
    mkdir -p "$CA_STATE"
    (umask 077; echo "Lc$(openssl rand -hex 16)" >"$pwfile")
  fi
  LOOM_DB_PASSWORD="$(cat "$pwfile")"
  export LOOM_DB_PASSWORD
}

ca_status() { aws cloudformation describe-stacks --stack-name "$CLAIMS_AWS_PREFIX-$1" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo MISSING; }
claims_aws_output() { # component key
  local v
  v="$(aws cloudformation describe-stacks --stack-name "$CLAIMS_AWS_PREFIX-$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null || true)"
  [ "$v" = None ] || echo "$v"
}
# A status the stack will not leave without another deploy: a failed
# operation, or any rollback (in progress or done).
ca_failed_status() { case "$1" in *_FAILED|*ROLLBACK*) return 0 ;; *) return 1 ;; esac; }
# "<stack> is <status> (first failed resource <id>: <reason>)".
claims_aws_failure() { # component status
  local first
  first="$(aws cloudformation describe-stack-events --stack-name "$CLAIMS_AWS_PREFIX-$1" \
    --query "reverse(StackEvents)[?ends_with(ResourceStatus, '_FAILED')] | [0].[LogicalResourceId, ResourceStatusReason]" \
    --output text 2>/dev/null | awk -F'\t' 'NF && $1 != "None" { print $1 ": " $2; exit }')"
  echo "$CLAIMS_AWS_PREFIX-$1 is $2${first:+ (first failed resource $first)}"
}

# ── the ledger sandbox ──────────────────────────────────────────────────────

# A clone of this repository with no remote, whose chant/lifecycle takes the
# records a claim's chant runs write. Made once per claims instance.
claims_ledger_sandbox() {
  local dir="$CA_STATE/ledger"
  if [ ! -d "$dir/.git" ]; then
    mkdir -p "$CA_STATE"
    git clone -q --shared --no-checkout "$CA_ROOT" "$dir" || return 1
    git -C "$dir" remote remove origin 2>/dev/null || true
  fi
  # The index matches this checkout's HEAD, so chant sees the work tree as git does.
  GIT_DIR="$dir/.git" GIT_WORK_TREE="$CA_ROOT" git read-tree HEAD 2>/dev/null \
    || GIT_DIR="$dir/.git" GIT_WORK_TREE="$CA_ROOT" git read-tree "$(git -C "$CA_ROOT" rev-parse HEAD)"
  CLAIMS_LEDGER_GIT_DIR="$dir/.git"
}

# Runs a command whose chant writes go to the sandbox: chant itself, or a just
# recipe that runs a chant Op. Never wrap a command that clones or commits
# (npm run vendor): GIT_DIR would point it at the sandbox too.
claims_chant() {
  [ -n "${CLAIMS_LEDGER_GIT_DIR:-}" ] || claims_ledger_sandbox || { ca_log "no ledger sandbox"; return 1; }
  GIT_DIR="$CLAIMS_LEDGER_GIT_DIR" GIT_WORK_TREE="$CA_ROOT" "$@"
}

# ── one deployment, shared ──────────────────────────────────────────────────

# The components to deploy for the ones named, with everything they depend on,
# in the graph's order.
ca_closure() { # component...
  local graph
  graph="$(cd "$CA_ROOT" && ./node_modules/.bin/chant graph --components --json 2>/dev/null)" || return 1
  jq -r --arg want "$*" '
    ($want | split(" ") | map(select(. != ""))) as $w
    | .edges as $e
    | def deps($c): [$c] + ([$e[] | select(.from == $c) | .to] | map(deps(.)) | add // []);
      ([$w[] | deps(.)] | add | unique) as $need
    | .order[] | select(. as $c | $need | index($c))' <<<"$graph"
}

# Deploys each named component (and its dependencies) under the prefix unless
# it is already up, one `chant run --components <c>` at a time (two at once
# would share the release ledger), seeding each from the outputs the earlier
# ones dumped. Vendors Loom once per claims run. Prints a line a minute while a
# deploy runs, so a granted run's stall watch sees progress. Returns 1 with the
# reason on stdout when a stack fails.
claims_aws_ensure() { # component...
  local want c st outdir seeds f pid ticks marker run_id
  want="$(ca_closure "$@")" || { echo "chant graph --components failed"; return 1; }
  outdir="$CA_STATE/outputs"
  mkdir -p "$outdir"
  run_id="${LOOM_CLAIMS_RUN_ID:-$$}"
  marker="$CA_STATE/vendored"
  for c in $want; do
    st="$(ca_status "$c")"
    case "$st" in
      CREATE_COMPLETE|UPDATE_COMPLETE) [ -s "$outdir/$c.json" ] && continue ;;
    esac
    if [ "$(cat "$marker" 2>/dev/null)" != "$run_id" ]; then
      ca_log "vendoring Loom (npm run vendor)"
      (cd "$CA_ROOT" && npm run -s vendor) >&2 || { echo "npm run vendor failed"; return 1; }
      echo "$run_id" >"$marker"
    fi
    seeds=()
    for f in "$outdir"/*.json; do [ -e "$f" ] && seeds+=(--seed-outputs "$f"); done
    ca_log "deploying $CLAIMS_AWS_PREFIX-$c (was $st)"
    (cd "$CA_ROOT" && claims_chant ./node_modules/.bin/chant run --components "$c" --env "$LOOM_ENV" \
      ${seeds[@]+"${seeds[@]}"} --dump-outputs "$outdir/$c.json") >&2 &
    pid=$!
    ticks=0
    while kill -0 "$pid" 2>/dev/null; do
      st="$(ca_status "$c")"
      if ca_failed_status "$st"; then
        kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
        claims_aws_failure "$c" "$st"; return 1
      fi
      [ $((ticks % 4)) -ne 0 ] || ca_log "$c: $st"
      ticks=$((ticks + 1))
      sleep 15
    done
    wait "$pid" || ca_log "chant run --components $c exited non-zero; checking its stack"
    st="$(ca_status "$c")"
    case "$st" in
      CREATE_COMPLETE|UPDATE_COMPLETE) ;;
      *) claims_aws_failure "$c" "$st"; return 1 ;;
    esac
  done
}

# The Loom the deployment serves: http://<ALB DNS name>, once /health answers.
claims_aws_base() {
  local domain code
  domain="$(claims_aws_output shared-foundation oDomainName)"
  [ -n "$domain" ] || { ca_log "shared-foundation has no oDomainName output"; return 1; }
  for _ in $(seq 1 40); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://$domain/health" 2>/dev/null || echo 000)"
    [ "$code" = 200 ] && { echo "http://$domain"; return 0; }
    ca_log "waiting for http://$domain/health ($code)"
    sleep 15
  done
  ca_log "http://$domain/health never answered 200 (last $code)"
  return 1
}

# Runs a command, logging a line a minute while it runs: chant prints a step's
# output only when the step ends, and a granted run's stall watch stops a run
# that writes nothing for LOOM_STALL_SECONDS (300).
claims_heartbeat() { # label command...
  local label="$1" pid n=0 rc
  shift
  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5; n=$((n + 5))
    [ $((n % 60)) -ne 0 ] || ca_log "$label: still running (${n}s)" 2>&9
  done
  wait "$pid"; rc=$?
  return "$rc"
}

# Seeds a profile (foundation, demo) through Loom's API, the ledger records in
# the sandbox.
claims_aws_seed() { # base token profile
  (cd "$CA_ROOT" && LOOM_API_BASE_URL="$1" LOOM_API_TOKEN="$2" LOOM_SEED_PROFILE="$3" \
    claims_heartbeat "loom-seed ($3)" claims_chant ./node_modules/.bin/chant run loom-seed --env "$LOOM_ENV")
}

# The SSM tunnel host (`just tunnel-host`, the loom-tunnel-host Op), once per
# instance, and its instance online in Systems Manager. The light tier's
# subnets have no NAT (the "private" ones are the public ones, and the host
# gets no public IP), so the host reaches SSM through the Op's interface
# endpoints (LOOM_TUNNEL_SSM_ENDPOINTS=true), the configuration the tunnel
# guide gives for subnets without NAT. Prints the instance id, or the reason
# and 1.
claims_aws_tunnel_host() {
  local id ping
  if [ "$(ca_status tunnel-host)" != CREATE_COMPLETE ] && [ "$(ca_status tunnel-host)" != UPDATE_COMPLETE ]; then
    (cd "$CA_ROOT" && LOOM_TUNNEL_SSM_ENDPOINTS="${LOOM_TUNNEL_SSM_ENDPOINTS:-true}" \
      claims_heartbeat "loom-tunnel-host" claims_chant ./node_modules/.bin/chant run loom-tunnel-host) >&2 \
      || { echo "chant run loom-tunnel-host failed ($(ca_status tunnel-host))"; return 1; }
  fi
  id="$(claims_aws_output tunnel-host oInstanceId)"
  [ -n "$id" ] || { echo "$CLAIMS_AWS_PREFIX-tunnel-host has no oInstanceId output"; return 1; }
  for _ in $(seq 1 60); do
    ping="$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$id" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
    [ "$ping" = Online ] && { echo "$id"; return 0; }
    ca_log "tunnel host $id: SSM ping ${ping:-none}"
    sleep 10
  done
  echo "the tunnel host $id never came online in Systems Manager"
  return 1
}

# ── an agent through Loom's API (the Agents screen's requests) ──────────────
# Each takes the base URL and a curl config file holding the bearer token.

ca_api() { local cfg="$1"; shift; curl -sS -K "$cfg" -H 'Content-Type: application/json' "$@"; }

# POST /api/agents (source=deploy, as ops/lib/seed.ts does for its demo agent)
# with the given execution role. Prints the agent id, or the reason and 1.
claims_aws_agent_deploy() { # base authcfg name role_arn description
  local base="$1" cfg="$2" name="$3" role="$4" desc="${5:-loomster claim}" models model body resp code id
  models="$(ca_api "$cfg" "$base/api/agents/models" 2>/dev/null || true)"
  # The seed's choice (#8): Nova Lite in this region's geography when listed, else the first model.
  model="$(jq -r '[.[]? | .model_id] as $ids | ([$ids[] | select(test("amazon\\.nova-lite-v1:0$"))] | .[0]) // $ids[0] // empty' <<<"$models" 2>/dev/null || true)"
  [ -n "$model" ] || { echo "GET /api/agents/models listed no model"; return 1; }
  body="$(jq -cn --arg n "$name" --arg m "$model" --arg r "$role" --arg d "$desc" '{
    source: "deploy", name: $n, description: $d, model_id: $m, role_arn: $r, protocol: "HTTP", network_mode: "PUBLIC",
    tags: {"loom:application": "loomster", "loom:group": "loomster", "loom:owner": "loomster"} }')"
  resp="$(ca_api "$cfg" -w '\n%{http_code}' -X POST "$base/api/agents" -d "$body" || true)"
  code="$(tail -n 1 <<<"$resp")"
  resp="$(sed '$d' <<<"$resp")"
  case "$code" in 2??) ;; *) echo "POST /api/agents returned $code: $(head -c 300 <<<"$resp")"; return 1 ;; esac
  id="$(jq -r '.id // empty' <<<"$resp")"
  [ -n "$id" ] || { echo "POST /api/agents returned no id"; return 1; }
  ca_log "agent $name (id $id, model $model) deploying"
  echo "$id"
}

# Polls GET /api/agents/<id>/status (what Loom's UI polls: it asks AgentCore,
# stores the state and creates the DEFAULT endpoint once the runtime is READY;
# GET /api/agents/<id> only returns the stored row). Prints
# "<status> <seconds> <reason>"; returns 0 only for READY with its endpoint.
claims_aws_agent_wait() { # base authcfg id
  local base="$1" cfg="$2" id="$3" timeout_s="${LOOM_CLAIM_AGENT_TIMEOUT:-900}" started agent status endpoint reason
  started="$(date +%s)"
  while :; do
    agent="$(ca_api "$cfg" "$base/api/agents/$id/status" 2>/dev/null || true)"
    status="$(jq -r '.status // empty' <<<"$agent" 2>/dev/null || true)"
    endpoint="$(jq -r '.endpoint_status // empty' <<<"$agent" 2>/dev/null || true)"
    ca_log "agent $id: status=$status endpoint_status=$endpoint deployment_status=$(jq -r '.deployment_status // empty' <<<"$agent" 2>/dev/null || true)"
    [ "$status" = FAILED ] && break
    [ "$status" = READY ] && { [ -z "$endpoint" ] || [ "$endpoint" = READY ]; } && break
    [ $(( $(date +%s) - started )) -lt "$timeout_s" ] || break
    sleep 15
  done
  reason="$(jq -r '[.deployment_status, .status_reason] | map(select(. != null and . != "")) | join(": ")' <<<"$agent" 2>/dev/null || true)"
  echo "${status:-none} $(( $(date +%s) - started )) $reason"
  [ "$status" = READY ]
}

# POST /api/agents/<id>/invoke once; returns 0 on a streamed chunk with no
# error event, else prints why.
claims_aws_agent_invoke() { # base authcfg id
  local out
  out="$(ca_api "$2" -N --max-time 180 -X POST "$1/api/agents/$3/invoke" \
    -d '{"prompt":"Reply with the single word ready."}' 2>&1 || true)"
  if grep -q '^event: error' <<<"$out"; then
    echo "invoke streamed an error: $(grep -A1 '^event: error' <<<"$out" | sed -n 's/^data: //p' | head -c 300)"; return 1
  fi
  grep -q '^event: chunk' <<<"$out" || { echo "invoke streamed no chunk: $(head -c 300 <<<"$out")"; return 1; }
}

# An access token for a throwaway admin (t-admin + g-admins-super), through the
# deployment's own user client (scripts/validate/get-user-token.sh). The pool
# goes with the instance, so the user does too.
claims_aws_token() {
  (cd "$CA_ROOT" && LOOM_ENV=claims LOOM_INSTANCE="$CLAIMS_AWS_INSTANCE" LOOM_E2E_USER="claims-admin" \
    bash scripts/validate/get-user-token.sh)
}

# ── the guard ───────────────────────────────────────────────────────────────

ca_tomorrow() { date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d tomorrow +%Y-%m-%d; }

# The month's spend so far in USD, unblended. Cost Explorer lags by up to a day.
claims_aws_spend() {
  ca_global ce get-cost-and-usage --time-period "Start=$(date -u +%Y-%m-01),End=$(ca_tomorrow)" \
    --granularity MONTHLY --metrics UnblendedCost \
    | jq -r '[.ResultsByTime[]?.Total.UnblendedCost.Amount | tonumber] | add // 0'
}

# The name of a cost budget with an alert at or under CA_ALERT_USD: an absolute
# threshold, or a percentage of the budget's limit that comes to that or less.
claims_aws_alert() {
  local acct budgets name limit
  acct="$(ca sts get-caller-identity | jq -r '.Account')" || return 1
  budgets="$(ca_global budgets describe-budgets --account-id "$acct")" || return 1
  while IFS=$'\t' read -r name limit; do
    [ -n "$name" ] || continue
    if ca_global budgets describe-notifications-for-budget --account-id "$acct" --budget-name "$name" \
      | jq -e --argjson l "${limit:-0}" --argjson a "$CA_ALERT_USD" '
          [.Notifications[]? | select(if .ThresholdType == "ABSOLUTE_VALUE" then .Threshold <= $a
                                      else (.Threshold * $l / 100) <= $a end)] | length > 0' >/dev/null; then
      echo "$name"
      return 0
    fi
  done < <(jq -r '.Budgets[]? | select(.BudgetType == "COST" and .BudgetLimit.Unit == "USD") | [.BudgetName, .BudgetLimit.Amount] | @tsv' <<<"$budgets")
  return 1
}

claims_aws_guard() {
  local file="$CA_STATE/guard" now at spend budget
  now="$(date +%s)"
  if [ -s "$file" ]; then
    read -r at spend budget <"$file" || true
    if [ -n "${at:-}" ] && [ $((now - at)) -lt "$CA_GUARD_TTL" ]; then
      ca_log "guard passed $(( (now - at) / 60 )) minutes ago: budget '$budget' alerts at \$$CA_ALERT_USD or less, \$$spend spent this month"
      return 0
    fi
  fi
  budget="$(claims_aws_alert)" \
    || { ca_log "REFUSED: no AWS Budgets cost budget alerts at \$$CA_ALERT_USD or less (aws budgets describe-budgets). Create one first, or raise LOOM_CLAIMS_ALERT_USD."; return 1; }
  spend="$(claims_aws_spend)" || { ca_log "REFUSED: Cost Explorer did not give this month's spend"; return 1; }
  if ! awk -v s="$spend" -v c="$CA_CAP_USD" 'BEGIN { exit !(s + 0 < c + 0) }'; then
    ca_log "REFUSED: \$$spend spent this month, at or over the \$$CA_CAP_USD cap (LOOM_CLAIMS_SPEND_CAP_USD)"
    return 1
  fi
  mkdir -p "$CA_STATE"
  # Budget names may hold spaces; the name is last on the line.
  echo "$now $spend $budget" >"$file"
  ca_log "guard: budget '$budget' alerts at \$$CA_ALERT_USD or less, \$$spend spent this month (cap \$$CA_CAP_USD)"
}

# ── cleanup ─────────────────────────────────────────────────────────────────

ca_stacks() {
  ca cloudformation list-stacks --stack-status-filter CREATE_COMPLETE CREATE_FAILED CREATE_IN_PROGRESS \
    ROLLBACK_COMPLETE ROLLBACK_FAILED UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED \
    DELETE_FAILED IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE \
    | jq -r --arg p "$CLAIMS_AWS_PREFIX-" '.StackSummaries[]? | select(.StackName | startswith($p)) | .StackName'
}
# AgentCore runtimes this instance created outside CloudFormation: the ones a
# claim names loomster_claim_<instance>_*, and any whose execution role is one
# of the instance's (the seed's demo agent, an agent on a per-agent role).
ca_runtimes() {
  local list id role
  list="$(ca bedrock-agentcore-control list-agent-runtimes 2>/dev/null || true)"
  jq -r --arg p "loomster_claim_${CLAIMS_AWS_INSTANCE}_" '.agentRuntimes[]? | select(.agentRuntimeName | startswith($p)) | .agentRuntimeId' <<<"$list"
  for id in $(jq -r --arg p "loomster_claim_${CLAIMS_AWS_INSTANCE}_" '.agentRuntimes[]? | select(.agentRuntimeName | startswith($p) | not) | .agentRuntimeId' <<<"$list"); do
    role="$(ca bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$id" 2>/dev/null | jq -r '.roleArn // empty' || true)"
    case "$role" in */"$CLAIMS_AWS_PREFIX"-*) echo "$id" ;; esac
  done
}

# What Loom created through its API outside every stack (agents' runtimes, A2A
# agents, memories), deleted through Loom while the backend still runs, so
# Loom removes the AWS side too (cleanup_aws=true). Best effort: the runtime
# sweep below catches what this misses.
ca_loom_cleanup() {
  local domain base token authcfg kind id
  [ "$(ca_status loom-backend)" != MISSING ] || return 0
  domain="$(claims_aws_output shared-foundation oDomainName)"
  [ -n "$domain" ] || return 0
  base="http://$domain"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$base/health" 2>/dev/null)" = 200 ] || return 0
  token="$(claims_aws_token 2>/dev/null)" || return 0
  authcfg="$(mktemp "${TMPDIR:-/tmp}/loomster-claims-cleanup.XXXXXX")"
  printf 'header = "Authorization: Bearer %s"\n' "$token" >"$authcfg"
  for kind in agents a2a/agents memories; do
    for id in $(curl -fsS -K "$authcfg" "$base/api/$kind" 2>/dev/null | jq -r '.[]?.id // empty' 2>/dev/null); do
      ca_log "deleting Loom $kind/$id"
      curl -fsS -K "$authcfg" -X DELETE "$base/api/$kind/$id?cleanup_aws=true" >/dev/null 2>&1 || true
    done
  done
  rm -f "$authcfg"
}
ca_repos() { ca ecr describe-repositories | jq -r --arg p "$CLAIMS_AWS_PREFIX-" '.repositories[]? | select(.repositoryName | startswith($p)) | .repositoryName'; }
ca_buckets() { ca s3api list-buckets | jq -r --arg p "$CLAIMS_AWS_PREFIX-" '.Buckets[]? | select(.Name | startswith($p)) | .Name'; }
ca_snapshots() { ca rds describe-db-snapshots --snapshot-type manual | jq -r --arg p "$CLAIMS_AWS_PREFIX-" '.DBSnapshots[]? | select(.DBSnapshotIdentifier | startswith($p)) | .DBSnapshotIdentifier'; }

ca_list() {
  local s
  for s in $(ca_stacks); do echo "stack $s"; done
  for s in $(ca_runtimes); do echo "agent-runtime $s"; done
  for s in $(ca_repos); do echo "ecr $s"; done
  for s in $(ca_buckets); do echo "bucket $s"; done
  for s in $(ca_snapshots); do echo "rds-snapshot $s"; done
}

ca_drop_bucket() {
  local b="$1" batch
  ca s3 rm "s3://$b" --recursive --quiet >/dev/null 2>&1 || true
  batch="$(ca s3api list-object-versions --bucket "$b" 2>/dev/null \
    | jq -c '{Objects: ([(.Versions // [])[], (.DeleteMarkers // [])[]] | map({Key, VersionId}) | .[0:1000]), Quiet: true}' || true)"
  if [ -n "$batch" ] && [ "$(jq '.Objects | length' <<<"$batch")" != 0 ]; then
    ca s3api delete-objects --bucket "$b" --delete "$batch" >/dev/null || true
  fi
  ca s3api delete-bucket --bucket "$b" >/dev/null
}

claims_aws_cleanup() { # [--list]
  claims_aws_prefix || return 1
  local listing c s r left
  listing="$(ca_list)"
  if [ -z "$listing" ]; then
    ca_log "nothing carries the prefix $CLAIMS_AWS_PREFIX"
    [ "${1:-}" = --list ] || ca_forget_instance
    return 0
  fi
  ca_log "carrying the prefix $CLAIMS_AWS_PREFIX:"
  while IFS= read -r l; do echo "  $l"; done <<<"$listing" >&2
  [ "${1:-}" = --list ] && return 0

  ca_loom_cleanup

  # A BREAK's inline deny would block CloudFormation's role delete.
  for s in $(ca_stacks); do
    for r in $(ca cloudformation describe-stack-resources --stack-name "$s" \
      | jq -r '.StackResources[]? | select(.ResourceType == "AWS::IAM::Role") | .PhysicalResourceId'); do
      ca iam delete-role-policy --role-name "$r" --policy-name "$CLAIMS_BREAK_POLICY" >/dev/null 2>&1 || true
    done
  done
  # Runtimes Loom created are outside CloudFormation and hold the agent role.
  for r in $(ca_runtimes); do
    ca bedrock-agentcore-control delete-agent-runtime --agent-runtime-id "$r" >/dev/null || true
  done
  # ECR repositories with images block shared-foundation's delete.
  for r in $(ca_repos); do ca ecr delete-repository --repository-name "$r" --force >/dev/null || true; done
  local wave waves deleting
  IFS='|' read -ra waves <<<"$CA_STACK_WAVES"
  for wave in "${waves[@]}"; do
    deleting=""
    for c in $wave; do
      s="$CLAIMS_AWS_PREFIX-$c"
      grep -qx "stack $s" <<<"$listing" || continue
      ca_log "deleting $s"
      ca cloudformation delete-stack --stack-name "$s" >/dev/null || true
      deleting="$deleting $s"
    done
    # One at a time is fine here: all of them are already deleting, so this
    # waits as long as the slowest one.
    for s in $deleting; do
      ca_wait_deleted "$s" || ca_log "$s did not delete cleanly"
    done
  done
  # Any other stack with the prefix (a component added since this list).
  for s in $(ca_stacks); do
    ca cloudformation delete-stack --stack-name "$s" >/dev/null || true
    ca_wait_deleted "$s" || ca_log "$s did not delete cleanly"
  done
  # What the stacks keep on purpose: the artifact bucket and the DB snapshot.
  for r in $(ca_buckets); do ca_drop_bucket "$r" || ca_log "bucket $r did not delete"; done
  for r in $(ca_snapshots); do ca rds delete-db-snapshot --db-snapshot-identifier "$r" >/dev/null || true; done
  for r in $(ca_repos); do ca ecr delete-repository --repository-name "$r" --force >/dev/null || true; done

  left="$(ca_list)"
  if [ -n "$left" ]; then
    ca_log "LEFT after cleanup:"
    while IFS= read -r l; do echo "  $l"; done <<<"$left" >&2
    return 1
  fi
  ca_forget_instance
  ca_log "cleanup: nothing carries the prefix $CLAIMS_AWS_PREFIX now"
}

# The instance's local state: its name, the database password, the outputs the
# deploys dumped, the ledger sandbox and the yodel project copy.
ca_forget_instance() {
  rm -rf "$CA_STATE/instance" "$CA_STATE/db-password" "$CA_STATE/outputs" "$CA_STATE/ledger" \
    "$CA_STATE/db-project" "$CA_STATE/vendored"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  cmd="${1:-}"
  shift || true
  case "$cmd" in
    guard) claims_aws_guard ;;
    spend) claims_aws_spend ;;
    prefix) claims_aws_prefix && echo "$CLAIMS_AWS_PREFIX" ;;
    cleanup) claims_aws_cleanup "$@" ;;
    *) sed -n 2,19p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
fi
