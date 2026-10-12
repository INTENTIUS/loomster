#!/usr/bin/env bash
#
# One claim per capability the docs state, each run plain and under BREAK=1.
#
#   test/claims.sh                    every claim
#   test/claims.sh --list             name, target, tier and summary of every claim
#   test/claims.sh --only a,b         the named claims; an area alone (`backend`)
#                                     names every claim in it
#   test/claims.sh --affected [base]  --only the claims test/claims-affected.sh
#                                     picks from the change since base (origin/main)
#   test/claims.sh ... --record FILE  also write a JSON row per claim and run into
#                                     FILE, keeping the rows of claims not run
#
# A claim is named <area>/<part> and lives in test/claims/<area>/<part>.sh, one
# script per claim: a new claim is a new file, and this runner needs no edit.
# Its header declares
#
#   # target: static | floci | aws    what it needs: nothing deployed, a Floci
#                                     emulator, or a real AWS account
#   # tier: any | light | production | production-ha
#   # summary: <one line: the documented statement it proves>
#   # order: <number>                 optional, 50 by default: within a target,
#                                     lower runs first
#
# Claims run static first, then floci, then aws, and by order within each, so
# the cheap ones fail fast. The aws claims of one run share one deployment
# (test/claims-aws.sh claims_aws_ensure): each adds the components it needs,
# and a claim's BREAK undoes itself on exit so it never breaks a later claim.
#
# and it prints exactly one line:
#
#   CLAIM claim=<name> verdict=pass|caught|fail|pending [detail]
#
# Plain, the claim checks the property: pass or fail. With BREAK=1 it breaks
# the property on purpose and must notice: caught, or fail when the check
# still passed (a claim that cannot fail). pending means the claim cannot run
# yet or here, and the detail says what it needs.
#
# The gate: static claims run as they are. floci and aws claims hold real
# infrastructure, so they go through test/human-gate.sh with their names (a
# person types "run", or granted them with `just grant`). Before any aws claim
# the spend guard runs (test/claims-aws.sh guard), and after the aws claims the
# cleanup deletes everything carrying the claims prefix (LOOM_CLAIMS_KEEP=1
# keeps it up).
#
# Each run's output goes to its own log under test/.state/claims-logs/<time>/.
# Exit codes: 0 when no run failed; 1 when one did; 2 for a bad argument or an
# unknown claim; 3 when the gate stops the run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CLAIMS_DIR="$HERE/claims"

usage() { sed -n 2,13p "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

# ── discovery ───────────────────────────────────────────────────────────────

# A header field of a claim script ("" when absent).
header() { # file, field
  awk -v f="$2" 'NR > 40 { exit } $1 == "#" && $2 == f ":" { $1 = ""; $2 = ""; sub(/^ +/, ""); print; exit }' "$1"
}

# name<TAB>target<TAB>tier<TAB>summary for every claim script, sorted by name.
discover() {
  local f rel name target tier
  [ -d "$CLAIMS_DIR" ] || return 0
  find "$CLAIMS_DIR" -mindepth 2 -maxdepth 2 -type f -name '*.sh' | sort | while read -r f; do
    rel="${f#"$CLAIMS_DIR"/}"
    name="${rel%.sh}"
    target="$(header "$f" target)"
    tier="$(header "$f" tier)"
    case "$target" in static|floci|aws) ;; *) target="invalid" ;; esac
    printf '%s\t%s\t%s\t%s\n' "$name" "$target" "${tier:-any}" "$(header "$f" summary)"
  done
}

CATALOG="$(discover)"

if [ "${1:-}" = --list ]; then
  [ -n "$CATALOG" ] && awk -F'\t' '{ printf "%-32s %-7s %-14s %s\n", $1, $2, $3, $4 }' <<<"$CATALOG"
  exit 0
fi

# ── arguments ───────────────────────────────────────────────────────────────

only="" record="" affected=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only) only="${2:?--only takes claim[,claim...]}"; shift 2 ;;
    --affected)
      affected=origin/main; shift
      if [ "$#" -gt 0 ] && [ "${1#--}" = "$1" ]; then affected="$1"; shift; fi ;;
    --record) record="${2:?--record takes a file}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "claims: unknown argument $1" >&2; usage ;;
  esac
done

all_names="$(cut -f1 <<<"$CATALOG" | grep . || true)"
if [ -n "$affected" ]; then
  only="$(bash "$HERE/claims-affected.sh" "$affected" | paste -sd, -)" || exit 2
  [ -n "$only" ] || { echo "claims: the change affects no claim" >&2; exit 0; }
fi

selected=""
if [ -n "$only" ]; then
  for n in $(tr ',' ' ' <<<"$only"); do
    if grep -qx -- "$n" <<<"$all_names"; then
      selected="$selected$n"$'\n'
    elif grep -q -- "^$n/" <<<"$all_names"; then
      selected="$selected$(grep -- "^$n/" <<<"$all_names")"$'\n'
    else
      echo "claims: $n is not a claim or an area of claims (test/claims.sh --list)" >&2
      exit 2
    fi
  done
  selected="$(grep . <<<"$selected" | awk '!seen[$0]++')"
else
  selected="$all_names"
fi
[ -n "$selected" ] || { echo "claims: no claims under test/claims/" >&2; exit 0; }

# Static, then floci, then aws; by the order header within each, then by name.
order_of() { local o; o="$(header "$CLAIMS_DIR/$1.sh" order)"; [[ "$o" =~ ^[0-9]+$ ]] && echo "$o" || echo 50; }
selected="$(for n in $selected; do
  case "$(awk -F'\t' -v n="$n" '$1 == n { print $2; exit }' <<<"$CATALOG")" in
    static) r=0 ;; floci) r=1 ;; aws) r=2 ;; *) r=3 ;;
  esac
  printf '%s\t%05d\t%s\n' "$r" "$(order_of "$n")" "$n"
done | sort -t$'\t' -k1,1n -k2,2n -k3,3 | cut -f3)"
if [ -n "$record" ] && ! command -v jq >/dev/null 2>&1; then
  echo "claims: --record needs jq" >&2; exit 2
fi

field() { awk -F'\t' -v n="$1" -v i="$2" '$1 == n { print $i; exit }' <<<"$CATALOG"; }

LOG_DIR="$HERE/.state/claims-logs/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$LOG_DIR"
# One id per run: the aws claims vendor Loom once per run (claims_aws_ensure).
export LOOM_CLAIMS_RUN_ID="${LOG_DIR##*/}"

# ── the gate ────────────────────────────────────────────────────────────────

gated="" aws_claims=""
for n in $selected; do
  case "$(field "$n" 2)" in
    floci) gated="$gated $n" ;;
    aws) gated="$gated $n"; aws_claims="$aws_claims $n" ;;
  esac
done
if [ -n "$gated" ]; then
  # shellcheck source=test/human-gate.sh
  . "$HERE/human-gate.sh"
  export LOOM_GATE_WATCH_DIRS="$LOG_DIR"
  # shellcheck disable=SC2086 # the names are words
  human_gate "claims that deploy to Floci or a real AWS account (real cost on AWS):$gated" $gated
fi

guard_refused=""
if [ -n "$aws_claims" ]; then
  # shellcheck source=test/claims-aws.sh
  . "$HERE/claims-aws.sh"
  # With no credentials nothing can spend: the claims say pending themselves.
  if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
    claims_aws_guard || guard_refused="the spend guard refused (test/claims-aws.sh guard)"
  fi
fi

# ── the runs ────────────────────────────────────────────────────────────────

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
rows="$LOG_DIR/rows.jsonl"
: >"$rows"
failed=0 aws_ran=0

emit() { # name, run, verdict, detail
  local n="$1" run="$2" v="$3" d="$4"
  echo "CLAIM claim=$n run=$run verdict=$v${d:+ $d}"
  [ "$v" = fail ] && failed=1
  if [ -n "$record" ]; then
    jq -cn --arg claim "$n" --arg target "$(field "$n" 2)" --arg tier "$(field "$n" 3)" --arg run "$run" \
      --arg verdict "$v" --arg detail "$d" --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sha "$SHA" \
      '{claim: $claim, target: $target, tier: $tier, run: $run, verdict: $verdict, detail: $detail, timestamp: $timestamp, sha: $sha}' >>"$rows"
  fi
}

run_claim() { # name, run (plain|break)
  local n="$1" run="$2" script="$CLAIMS_DIR/$1.sh" log lines line verdict detail
  log="$LOG_DIR/${n//\//__}.$run.log"
  if [ "$(field "$n" 2)" = invalid ]; then
    emit "$n" "$run" fail "the header declares no target (static, floci or aws)"; return
  fi
  if [ -n "$guard_refused" ] && [ "$(field "$n" 2)" = aws ]; then
    emit "$n" "$run" fail "not run: $guard_refused"; return
  fi
  if [ "$run" = break ]; then
    (cd "$ROOT" && BREAK=1 bash "$script") >"$log" 2>&1 </dev/null || true
  else
    (cd "$ROOT" && env -u BREAK bash "$script") >"$log" 2>&1 </dev/null || true
  fi
  lines="$(grep -E "^CLAIM claim=" "$log" || true)"
  if [ -z "$lines" ]; then
    emit "$n" "$run" fail "printed no CLAIM line (log $log: $(tail -n 1 "$log"))"; return
  fi
  if [ "$(wc -l <<<"$lines" | tr -d ' ')" != 1 ]; then
    emit "$n" "$run" fail "printed more than one CLAIM line (log $log)"; return
  fi
  line="$lines"
  case "$line" in
    "CLAIM claim=$n verdict="*) ;;
    *) emit "$n" "$run" fail "printed a CLAIM line for another name: $line"; return ;;
  esac
  line="${line#"CLAIM claim=$n verdict="}"
  verdict="${line%% *}"
  detail=""
  [ "$verdict" = "$line" ] || detail="${line#* }"
  case "$run:$verdict" in
    plain:pass|plain:fail|plain:pending|break:caught|break:fail|break:pending) ;;
    plain:caught) verdict=fail detail="printed caught without BREAK${detail:+: $detail}" ;;
    break:pass) verdict=fail detail="printed pass under BREAK=1: the claim cannot fail${detail:+: $detail}" ;;
    *) verdict=fail detail="unknown verdict '$verdict'${detail:+: $detail}" ;;
  esac
  [ "$(field "$n" 2)" = aws ] && [ "$verdict" != pending ] && aws_ran=1
  emit "$n" "$run" "$verdict" "$detail"
}

# Stopped part way (the grant's stall watch sends TERM, or ^C): stop the claim
# that is running, so its exit trap undoes any BREAK, then clean up what the
# aws claims deployed instead of leaving it running.
aws_started=0
# shellcheck disable=SC2329 # invoked by the trap below
on_stop() {
  trap - TERM INT
  echo "claims: stopped; ending the running claim" >&2
  pkill -TERM -P $$ 2>/dev/null || true
  wait 2>/dev/null || true
  if [ "$aws_started" = 1 ] && [ "${LOOM_CLAIMS_KEEP:-}" != 1 ]; then
    claims_aws_cleanup || echo "claims: the aws cleanup left resources behind (test/claims-aws.sh cleanup --list)" >&2
  fi
  exit 143
}
trap on_stop TERM INT

for n in $selected; do
  [ "$(field "$n" 2)" != aws ] || aws_started=1
  run_claim "$n" plain
  run_claim "$n" break
done

if [ "$aws_ran" = 1 ] && [ "${LOOM_CLAIMS_KEEP:-}" != 1 ]; then
  claims_aws_cleanup || { echo "claims: the aws cleanup left resources behind (test/claims-aws.sh cleanup --list)" >&2; failed=1; }
fi

if [ -n "$record" ]; then
  [ -s "$record" ] || echo '[]' >"$record"
  jq -s --slurpfile old "$record" '
    . as $new
    | ($old[0] // [])
    | map(select(. as $o | $new | any(.claim == $o.claim and .run == $o.run) | not))
    | . + $new
    | sort_by(.claim, .run)' "$rows" >"$record.tmp" && mv "$record.tmp" "$record"
  echo "claims: recorded $(wc -l <"$rows" | tr -d ' ') rows in $record" >&2
fi
echo "claims: logs in $LOG_DIR" >&2
exit "$failed"
