#!/usr/bin/env bash
#
# scripts/estimate-cost.sh — optional build-time cost-estimate hook (chant#896).
#
# chant carries no pricing data and no pricing logic of its own. This script
# shells out to Infracost (https://www.infracost.io) against the
# already-synthesized CloudFormation templates in dist/ (`npm run synth`)
# and relays whatever Infracost reports — one estimate per Loom component.
# It is opt-in and has no hard dependency: a missing `infracost` binary,
# missing credentials, an unsupported Infracost CLI version, or any
# Infracost error is a skip with a printed notice, never a build/CI failure
# (chant#896 acceptance criteria).
#
# Usage:
#   npm run synth           # produce dist/*.template.json first
#   npm run estimate-cost   # this script
#
# Requires a real `infracost` install, authenticated via `infracost auth
# login` locally or INFRACOST_CLI_AUTHENTICATION_TOKEN in CI — see
# https://www.infracost.io/docs/features/get_started/. See README.md's
# "Cost estimate (optional)" section for the full picture, including the
# CloudFormation-support caveat referenced below.

set -uo pipefail

DIST_DIR="${DIST_DIR:-dist}"
OUT_DIR="${COST_ESTIMATE_OUT_DIR:-$DIST_DIR/cost-estimates}"

notice() { echo "estimate-cost: $*"; }

if ! command -v infracost >/dev/null 2>&1; then
  notice "infracost is not installed — skipping (opt-in hook, no hard dependency on it)."
  notice "Install: https://www.infracost.io/docs/features/get_started/ — then re-run \`npm run estimate-cost\`."
  exit 0
fi

shopt -s nullglob
templates=("$DIST_DIR"/*.template.json)
if [ ${#templates[@]} -eq 0 ]; then
  notice "no synthesized templates found in $DIST_DIR — run \`npm run synth\` first. Skipping."
  exit 0
fi

# Infracost's CLI moved from `breakdown --path` to `scan <path>` across CLI
# generations — try the current command first, fall back to the older one so
# this hook keeps working across whatever Infracost version CI or a
# developer happens to have installed. Neither branch computes a price of
# its own; both just hand the template to Infracost and relay its output.
run_infracost() {
  local template="$1" json_out="$2"
  if infracost scan --help >/dev/null 2>&1; then
    infracost scan "$template" --json >"$json_out" 2>"$json_out.stderr"
    return $?
  fi
  infracost breakdown --path "$template" --format json >"$json_out" 2>"$json_out.stderr"
  return $?
}

mkdir -p "$OUT_DIR"
notice "found ${#templates[@]} synthesized component template(s) in $DIST_DIR — running Infracost per component"

any_succeeded=0
for template in "${templates[@]}"; do
  component="$(basename "$template" .template.json)"
  json_out="$OUT_DIR/$component.json"

  if run_infracost "$template" "$json_out"; then
    any_succeeded=1
    total="n/a"
    if command -v jq >/dev/null 2>&1; then
      # Best-effort read of Infracost's own already-computed total across a
      # couple of known CLI-generation JSON shapes — a relay/display concern,
      # not pricing logic of our own.
      total=$(jq -r '.totalMonthlyCost // .summary.totalMonthlyCost // .projects[0].breakdown.totalMonthlyCost // "n/a"' "$json_out" 2>/dev/null || echo "n/a")
    fi
    notice "$component: estimate written to $json_out (Infracost-reported total monthly cost: \$${total})"
    rm -f "$json_out.stderr"
  else
    notice "$component: Infracost could not produce an estimate for this template — skipping this component, not failing the build."
    notice "  Details: $json_out.stderr (common causes: missing/expired credentials, or upstream CloudFormation support not yet available in your Infracost CLI version — see README.md's cost-estimate section)."
  fi
done

if [ "$any_succeeded" -eq 0 ]; then
  notice "no component estimate succeeded this run — still not a build failure (opt-in hook). See notices above for why."
fi

notice "done — per-component Infracost output (where available) is in $OUT_DIR/."
exit 0
