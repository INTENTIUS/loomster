#!/usr/bin/env bash
# Install scripts/git-hooks/pre-push as this clone's pre-push hook: it keeps
# chant's lifecycle ledger (the chant/lifecycle branch) off origin unless
# CI is set or LOOM_LEDGER_PUSH=1. See the hook for why.
#
# The installed hook is a stub that runs the checked-out copy, so later
# changes to the guard need no reinstall. An existing pre-push hook that is
# not ours is left alone.
set -euo pipefail

hooks="$(git rev-parse --git-path hooks)"
target="$hooks/pre-push"
marker="loomster ledger guard"

if [ -e "$target" ] && ! grep -q "$marker" "$target"; then
  echo "install-git-hooks: $target exists and is not loomster's; add scripts/git-hooks/pre-push to it by hand" >&2
  exit 0
fi

mkdir -p "$hooks"
cat >"$target" <<'HOOK'
#!/usr/bin/env bash
# loomster ledger guard stub: runs scripts/git-hooks/pre-push from the checkout.
guard="$(git rev-parse --show-toplevel)/scripts/git-hooks/pre-push"
[ -x "$guard" ] || exit 0
exec "$guard" "$@"
HOOK
chmod +x "$target"
echo "install-git-hooks: pre-push guard installed at $target"
