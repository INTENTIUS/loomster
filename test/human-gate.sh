#!/usr/bin/env bash
# The human gate in front of every script that holds real infrastructure: the
# floci and aws claims (test/claims.sh), the production E2Es and the runtime
# E2Es. A person starts one in a terminal of their own by typing "run". A coding
# agent has no terminal to type in: it gets the stop message below and exit 3.
#
#   . "$HERE/human-gate.sh"; human_gate "<what this holds>" [<name>...]
#
# A grant lets an agent start what a person named, a set number of times:
# `just grant <name>...` (test/grant.sh) asks the person to type "run" and
# writes the names, the runs each may have (2 by default: a run, and one more
# after a fix) and when the grant expires (4 hours by default). With no
# terminal, the gate passes only when every <name> the caller passes is
# granted with a run left, and takes one run of each. A granted run is watched:
# when it writes nothing for LOOM_STALL_SECONDS (300), or the grant expires,
# the watch stops it and says where it went quiet.
#
# CI runs pass (GITHUB_ACTIONS or GITLAB_CI set). Once a person typed "run",
# the scripts it starts inherit LOOM_HUMAN_RUN and do not ask again.

GRANT_FILE="${LOOM_GRANT_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/loomster/agent-grant}"

# Why the grant does not cover the names, or nothing when it does.
grant_refusal() {
  [ -f "$GRANT_FILE" ] || { echo "no grant: a person runs just grant <name>... first"; return; }
  local expires now name runs
  expires="$(awk '$1 == "expires" { print $2 }' "$GRANT_FILE")"
  now="$(date +%s)"
  { [ -n "$expires" ] && [ "$now" -lt "$expires" ]; } || { echo "the grant expired"; return; }
  for name in "$@"; do
    runs="$(awk -v n="$name" '$1 == n { print $2 }' "$GRANT_FILE")"
    [ -n "$runs" ] || { echo "$name is not in the grant"; return; }
    [ "$runs" -gt 0 ] || { echo "$name has no runs left in the grant: report what failed to the person"; return; }
  done
}

# Takes one run of each name from the grant.
grant_take() {
  local tmp="$GRANT_FILE.$$" name
  cp "$GRANT_FILE" "$tmp"
  for name in "$@"; do
    awk -v n="$name" '$1 == n { $2 = $2 - 1 } { print }' "$tmp" > "$tmp.next" && mv "$tmp.next" "$tmp"
  done
  mv "$tmp" "$GRANT_FILE"
}

# The process and everything it started, children first, except the process
# $2 (the watch calling this, itself a child of the run).
gate_kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    [ "$child" = "${2:-}" ] || gate_kill_tree "$child" "${2:-}"
  done
  kill -TERM "$1" 2>/dev/null || true
}

# Watches the run that sourced this file ($$). Everything the run prints goes
# through a log as well (GATE_LOG), and a caller can name more directories to
# watch in LOOM_GATE_WATCH_DIRS (the claims runner names its per-claim logs).
# The watch stops the run when none of that changes for LOOM_STALL_SECONDS, or
# when the grant expires.
grant_watch() {
  local target=$$ quiet="${LOOM_STALL_SECONDS:-300}" poll="${LOOM_GRANT_POLL:-5}" expires mark
  expires="$(awk '$1 == "expires" { print $2 }' "$GRANT_FILE")"
  GATE_LOG="$(mktemp "${TMPDIR:-/tmp}/loomster-gate-log.XXXXXX")"
  mark="$(mktemp "${TMPDIR:-/tmp}/loomster-gate-mark.XXXXXX")"
  (
    trap - EXIT
    # Keeps stderr for its message.
    exec >/dev/null </dev/null
    last="$(date +%s)" newest=""
    while kill -0 "$target" 2>/dev/null; do
      sleep "$poll"
      # shellcheck disable=SC2086 # LOOM_GATE_WATCH_DIRS is a space-separated list
      found="$(find "$GATE_LOG" ${LOOM_GATE_WATCH_DIRS:-} -type f -newer "$mark" 2>/dev/null | head -50)"
      if [ -n "$found" ]; then
        # shellcheck disable=SC2086,SC2012
        newest="$(ls -t $found 2>/dev/null | head -1)"
        last="$(date +%s)"
        touch "$mark"
      fi
      now="$(date +%s)"
      if [ $((now - last)) -ge "$quiet" ] || [ "$now" -ge "$expires" ]; then
        {
          if [ "$now" -ge "$expires" ]; then echo "STOPPED: the grant expired while this ran."
          else echo "STOPPED: nothing written for $((now - last)) s."; fi
          if [ -n "$newest" ]; then echo "Last written: $newest"; tail -n 5 "$newest" 2>/dev/null; fi
          echo "Report this to the person; do not start it again without them."
        } >&2
        echo "STOPPED by the grant watch: nothing written for $((now - last)) s, or the grant expired." >>"$GATE_LOG"
        # bash 3.2 (macOS) has no BASHPID; its BSD pgrep leaves out its own ancestors anyway.
        gate_kill_tree "$target" "${BASHPID:-}"
        rm -f "$mark"
        exit 0
      fi
    done
    rm -f "$mark"
  ) &
  disown 2>/dev/null || true
  # Everything the run prints from here on also lands in GATE_LOG, so output
  # on stdout counts as activity.
  exec > >(tee -a "$GATE_LOG") 2> >(tee -a "$GATE_LOG" >&2)
}

human_gate() {
  local what="$1"
  shift
  if [ -n "${GITHUB_ACTIONS:-}" ] || [ -n "${GITLAB_CI:-}" ]; then return 0; fi
  [ "${LOOM_HUMAN_RUN:-}" = ok ] && return 0
  if ! { : >/dev/tty; } 2>/dev/null; then
    local why=""
    if [ "$#" -gt 0 ]; then
      why="$(grant_refusal "$@")"
      if [ -z "$why" ]; then
        grant_take "$@"
        echo "Granted run of $*: $(awk 'NR > 1 { printf "%s%s %s left", s, $1, $2; s = ", " }' "$GRANT_FILE")." >&2
        grant_watch
        # What this run starts is part of it, as after a person's "run".
        export LOOM_HUMAN_RUN=ok
        return 0
      fi
    fi
    cat >&2 <<EOF

STOP. This runs $what.
A person starts it, in their own terminal, or grants it with just grant.${why:+
Not granted: $why.}

If you are a coding agent: do not run this, do not set LOOM_HUMAN_RUN, do not
write the grant file, and do not look for another way to start it. Merge on CI
(typecheck, chant lint, unit tests). If a run seems needed, stop and ask the
person, naming what it would deploy and the claims to grant.

EOF
    exit 3
  fi
  printf '\nThis runs %s.\nType run to start it: ' "$what" >/dev/tty
  local answer=""
  read -r answer </dev/tty || true
  [ "$answer" = run ] || { echo "not started" >&2; exit 3; }
  export LOOM_HUMAN_RUN=ok
}
