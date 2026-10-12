#!/usr/bin/env bash
# Check loomster's CloudFormation Guard rules (policies/production.guard,
# loomster#27) both ways:
#   1. every production-tier template synthesized from this checkout passes;
#   2. policies/fixtures/violations.template.json fails every rule, so a rule
#      that stopped matching anything shows up here instead of passing quietly.
#
#   just policy                 # needs cfn-guard on PATH, or CFN_GUARD=<path>
#
# The production tiers need a VPC you bring; the synth uses placeholder ids,
# which is all a template needs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
GUARD="${CFN_GUARD:-cfn-guard}"
command -v "$GUARD" >/dev/null 2>&1 || { echo "policy: cfn-guard not found; install it (https://github.com/aws-cloudformation/cloudformation-guard) or set CFN_GUARD" >&2; exit 1; }
RULES=policies/production.guard
RULE_NAMES="$(sed -n 's/^rule \([a-z0-9_]*\) .*/\1/p' "$RULES")"
LOG="$(mktemp "${TMPDIR:-/tmp}/loomster-policy-synth.XXXXXX")"
trap 'rm -f "$LOG"' EXIT

for tier in production production-ha; do
  echo "policy: synthesizing the $tier templates"
  LOOM_TIER="$tier" LOOM_ENV=policy LOOM_INSTANCE=a LOOM_DB_PASSWORD=PolicyCheck12345 AWS_ACCOUNT_ID=111111111111 \
    LOOM_VPC_ID=vpc-0123456789abcdef0 LOOM_PUBLIC_SUBNET_IDS=subnet-0a,subnet-0b LOOM_PRIVATE_SUBNET_IDS=subnet-0c,subnet-0d \
    LOOM_DOMAIN_NAME=loom.example.com npm run -s synth >"$LOG" 2>&1 || { cat "$LOG" >&2; echo "policy: the $tier synth failed" >&2; exit 1; }
  if ! "$GUARD" validate -r "$RULES" -d dist --show-summary fail; then
    echo "policy: the $tier templates break $RULES" >&2
    exit 1
  fi
  echo "policy: the $tier templates pass $RULES"
done

OUT="$("$GUARD" validate -r "$RULES" -d policies/fixtures/violations.template.json --show-summary fail 2>&1 || true)"
MISSED=""
for rule in $RULE_NAMES; do
  grep -Eq "${rule}[[:space:]]+FAIL" <<<"$OUT" || MISSED="$MISSED $rule"
done
[ -z "$MISSED" ] || { echo "policy: these rules didn't fail the violations fixture:$MISSED" >&2; exit 1; }
echo "policy: every rule fails the violations fixture ($(wc -w <<<"$RULE_NAMES" | tr -d ' ') rules)"
