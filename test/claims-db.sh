#!/usr/bin/env bash
#
# What the db/* claims share (sourced, not run): a scratch copy of the yodel
# project and the approvals a claim gives in it.
#
# yodel's gates are real: `yodel apply` and `yodel init --baseline` stop at a
# gate bound to the plan digest until someone approves that exact plan, and
# chant records the approval on the project repository's chant/lifecycle and
# pushes it. A claim proves the gate holds and that an approved plan applies,
# so it has to approve; it does so in a scratch git repository holding a copy
# of db/ with no remote (LOOM_DB_PROJECT_DIR, which scripts/db/yodel.sh reads),
# so the approval and every ledger record stay there and the cleanup deletes
# them. The real project's gates and ledger are never touched.

CD_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CD_ROOT="$(cd "$CD_HERE/.." && pwd)"

# Copies db/ to <dir> (once), makes it a git repository with one commit and no
# remote, and exports LOOM_DB_PROJECT_DIR. The copy sits under the checkout, so
# its imports resolve this checkout's node_modules.
claims_db_project() { # dir
  local dir="$1"
  if [ ! -d "$dir/.git" ]; then
    mkdir -p "$dir"
    cp -R "$CD_ROOT/db/." "$dir/"
    git -C "$dir" init -q -b main
    git -C "$dir" add -A
    git -C "$dir" -c user.name=loomster-claims -c user.email=claims@loomster.invalid commit -q -m "scratch copy of db/ for a claim"
  fi
  export LOOM_DB_PROJECT_DIR="$dir"
}

# Runs scripts/db/yodel.sh with --json where it takes it; prints its output,
# returns its exit code.
claims_db() { (cd "$CD_ROOT" && bash scripts/db/yodel.sh "$@"); }

# Approves, in the scratch project, the plan a gated run printed: chant's own
# approve command from the run's --json output (chantApprove), as a person's
# `yodel approve` would record it.
claims_db_approve() { # json-output-file
  local cmd
  cmd="$(jq -r '[.. | .chantApprove? // empty | strings] | .[0] // empty' "$1" 2>/dev/null || true)"
  [ -n "$cmd" ] || cmd="$(grep -oE 'chant approve [^"]+' "$1" | head -n 1)"
  [ -n "$cmd" ] || { echo "the gated run printed no chant approve command"; return 1; }
  (cd "$LOOM_DB_PROJECT_DIR" && PATH="$CD_ROOT/node_modules/.bin:$PATH" \
    bash -c "$cmd --actor loomster-claims --note 'loomster claim run'" >&2) || { echo "chant approve failed: $cmd"; return 1; }
}

# How many migrations the deployment's history records applied ("" when
# status could not say).
claims_db_applied() {
  claims_db status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log((j.applied??[]).length)}catch{console.log("")}})'
}

# Records the baseline (`just db baseline`), approving its gate once: exit 3
# stops at the gate, the claim approves the printed plan, then runs it again.
# Already recorded counts as done. Prints the reason and returns 1 on failure.
claims_db_baseline() { # workdir
  local w="$1" rc
  [ "$(claims_db_applied)" -ge 1 ] 2>/dev/null && return 0
  set +e; claims_db baseline --json >"$w/baseline.json" 2>"$w/baseline.err"; rc=$?; set -e
  if [ "$rc" = 3 ]; then
    claims_db_approve "$w/baseline.json" || return 1
    set +e; claims_db baseline --json >"$w/baseline2.json" 2>"$w/baseline2.err"; rc=$?; set -e
    [ "$rc" = 0 ] || { echo "baseline after approval exited $rc: $(tail -n 2 "$w/baseline2.err" | tr '\n' ' ' | head -c 300)"; return 1; }
    return 0
  fi
  [ "$rc" = 0 ] && return 0
  echo "baseline exited $rc (3 gated, 4 refused): $(tail -n 3 "$w/baseline.err" | tr '\n' ' ' | head -c 400)"
  return 1
}

# The column BREAK runs change out of band, and how to put it back. A free-text
# column of a table Loom reads rarely; text to varchar(4000) changes its type,
# which drift reports, and changing it back is lossless.
# shellcheck disable=SC2034 # read by the db/* claims that source this file
CLAIMS_DB_BREAK_SQL="ALTER TABLE public.agents ALTER COLUMN description TYPE character varying(4000);"
# shellcheck disable=SC2034 # read by the db/* claims that source this file
CLAIMS_DB_UNBREAK_SQL="ALTER TABLE public.agents ALTER COLUMN description TYPE text;"
