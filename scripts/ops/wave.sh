#!/usr/bin/env bash
# The plan and apply commands of loomster's Op waves (ops/waves/*.json, #28):
# chant's wave runner (`chant run wave --spec <file> --wave <k>`) calls them
# once per run. A run's target is `<env>.<instance>` (`prod.a`), and its Op is
# the tier's own (`loom-upgrade-production`), since each Op's tier is fixed.
#
#   scripts/ops/wave.sh plan  <op> <env>.<instance> <plan-file>
#   scripts/ops/wave.sh apply <op> <env>.<instance>
#
# plan writes `{ "planDigest", "destructive" }` to <plan-file>. The digest
# covers the Op, the target and this checkout's tree, so a wave's set digest
# changes whenever what it would apply changes. A production-tier Op counts as
# destructive (it migrates the schema and rolls the backend).
#
# apply runs the Op for that deployment: LOOM_ENV and LOOM_INSTANCE from the
# target, the rest of the environment as the job has it. The Op keeps its own
# preflight, snapshot and gate; on a gated tier the run stops at the Op's gate
# (exit 3) until a person approves it, like any other `chant run`.
set -euo pipefail

cmd="${1:-}" op="${2:-}" target="${3:-}"
case "$target" in
  *.*) env="${target%%.*}" instance="${target#*.}" ;;
  *) echo "wave: target \"$target\" is not <env>.<instance>" >&2; exit 2 ;;
esac
[[ "$env" =~ ^[a-z0-9-]+$ && "$instance" =~ ^[a-z0-9-]+$ ]] || { echo "wave: target \"$target\": env and instance are lowercase letters, digits and -" >&2; exit 2; }
[[ "$op" =~ ^loom-[a-z0-9-]+$ ]] || { echo "wave: \"$op\" is not a loomster Op" >&2; exit 2; }

case "$cmd" in
  plan)
    out="${4:?wave plan needs the plan file}"
    tree="$(git rev-parse 'HEAD^{tree}')"
    digest="sha256:$(printf '%s\n%s\n%s\n' "$op" "$target" "$tree" | shasum -a 256 | cut -d' ' -f1)"
    case "$op" in *-production|*-production-ha) destructive=true ;; *) destructive=false ;; esac
    mkdir -p "$(dirname "$out")"
    printf '{"planDigest":"%s","destructive":%s}\n' "$digest" "$destructive" >"$out"
    echo "wave: planned $op for $target ($digest)"
    ;;
  apply)
    echo "wave: running $op for $target"
    LOOM_ENV="$env" LOOM_INSTANCE="$instance" exec npx chant run "$op" --env "$env"
    ;;
  *) echo "usage: scripts/ops/wave.sh plan|apply <op> <env>.<instance> [plan-file]" >&2; exit 2 ;;
esac
