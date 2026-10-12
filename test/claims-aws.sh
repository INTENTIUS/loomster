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
CA_STATE="$CA_HERE/.state/claims-aws"
CA_ALERT_USD="${LOOM_CLAIMS_ALERT_USD:-10}"
CA_CAP_USD="${LOOM_CLAIMS_SPEND_CAP_USD:-25}"
# Cost Explorer bills $0.01 a request, so a passed guard is kept this long.
CA_GUARD_TTL="${LOOM_CLAIMS_GUARD_TTL:-1800}"
# Delete order: consumers before what they consume (the component graph's
# waves, last wave first).
# The inline policy a BREAK run attaches to a role it denies; the cleanup
# removes it from every role of the prefix's stacks.
CLAIMS_BREAK_POLICY=loomster-claim-break
CA_STACK_ORDER="loom-agents downstream-stub loom-backend loom-frontend loom-db loom-cognito shared-foundation"

ca_log() { echo "[claims-aws] $*" >&2; }

ca() { AWS_PAGER="" aws --region "${AWS_REGION:-us-east-1}" --output json "$@" </dev/null; }
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
ca_runtimes() {
  ca bedrock-agentcore-control list-agent-runtimes 2>/dev/null \
    | jq -r --arg p "loomster_claim_${CLAIMS_AWS_INSTANCE}_" '.agentRuntimes[]? | select(.agentRuntimeName | startswith($p)) | .agentRuntimeId'
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
    [ "${1:-}" = --list ] || rm -f "$CA_STATE/instance" "$CA_STATE/db-password"
    return 0
  fi
  ca_log "carrying the prefix $CLAIMS_AWS_PREFIX:"
  while IFS= read -r l; do echo "  $l"; done <<<"$listing" >&2
  [ "${1:-}" = --list ] && return 0

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
  for c in $CA_STACK_ORDER; do
    s="$CLAIMS_AWS_PREFIX-$c"
    grep -qx "stack $s" <<<"$listing" || continue
    ca_log "deleting $s"
    ca cloudformation delete-stack --stack-name "$s" >/dev/null || true
    ca cloudformation wait stack-delete-complete --stack-name "$s" || ca_log "$s did not delete cleanly"
  done
  # Any other stack with the prefix (a component added since this list).
  for s in $(ca_stacks); do
    ca cloudformation delete-stack --stack-name "$s" >/dev/null || true
    ca cloudformation wait stack-delete-complete --stack-name "$s" || ca_log "$s did not delete cleanly"
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
  rm -f "$CA_STATE/instance" "$CA_STATE/db-password"
  ca_log "cleanup: nothing carries the prefix $CLAIMS_AWS_PREFIX now"
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
