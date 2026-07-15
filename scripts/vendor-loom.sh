#!/usr/bin/env bash
#
# scripts/vendor-loom.sh — fetch awslabs/loom's application source, pinned to
# a single tag, into vendor/loom/ (gitignored).
#
# Why this exists: loom-backend/loom-frontend's `docker-build` step
# (src/components/loom-backend.component.ts, loom-frontend.component.ts)
# needs Loom's real Dockerfiles + application source as its build context.
# That source is not vendored into this repo (it lives upstream, licensed
# and released separately) — this script is the one place that fetches it.
#
# Pinned by tag *and* commit sha. A git tag is a mutable ref — upstream could
# force-move `LOOM_TAG` to point at different content after this script was
# authored against it. `LOOM_EXPECTED_SHA` is the commit `LOOM_TAG` resolved
# to when this script was last verified against the real awslabs/loom repo;
# if the tag now resolves to something else, that is exactly the "tag moved"
# case the acceptance criteria call out — fail loudly rather than silently
# vendoring different content than every Dockerfile-path/context assumption
# in this repo was verified against.
#
# Sparse checkout: only backend/, frontend/, and agents/ (the three
# directories loom-backend/loom-frontend's Dockerfiles need — see below for
# why loom-backend's build needs agents/ too) are pulled, not Loom's full
# tree (docs, IaC templates, tests, etc. this repo has no use for).
#
# Run this right before a real `chant run` deploy or a manual `docker build`
# — not before `npm run tsc`/`chant lint .`/`npm test`. `tsc` is safe either
# way (tsconfig.json's `include` is an explicit allow-list that never
# reaches vendor/), but `chant lint .` (and any whole-project `chant build`/
# `chant lifecycle` invocation without `--src` scoping) walks every `.ts`
# file under the given path with no gitignore-awareness and no configurable
# exclude — if vendor/loom exists on disk when one of those runs, it treats
# Loom's own vendored frontend TypeScript as project source and reports
# EVL00x/COMP00x findings against it. This repo's own CI (.github/workflows/
# ci.yml) never runs this script, so that gate stays unaffected; if you vendor
# locally, `rm -rf vendor/loom` (or just don't vendor) before `just check`.
#
# Usage:
#   npm run vendor              # or: bash scripts/vendor-loom.sh
#   LOOM_TAG=v1.7.0 LOOM_EXPECTED_SHA=<sha> bash scripts/vendor-loom.sh
#     # re-pin to a newer tag once its sha is known-verified (update the
#     # defaults below at the same time, so a plain `npm run vendor` stays
#     # correct for the next person)

set -euo pipefail

LOOM_REPO="${LOOM_REPO:-https://github.com/awslabs/loom}"
LOOM_TAG="${LOOM_TAG:-v1.6.0}"
# Commit `refs/tags/v1.6.0` resolved to as of this script's authoring —
# see the file header. Verify with: git ls-remote --tags "$LOOM_REPO" "$LOOM_TAG"
LOOM_EXPECTED_SHA="${LOOM_EXPECTED_SHA:-8c658d61ca28d11bdc63c42d8f2787f1ed82e65c}"
VENDOR_DIR="${VENDOR_DIR:-vendor/loom}"

notice() { echo "vendor-loom: $*"; }
fail() {
  echo "vendor-loom: ERROR: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required on PATH."

notice "resolving $LOOM_REPO refs/tags/$LOOM_TAG ..."
resolved_line="$(git ls-remote --tags "$LOOM_REPO" "refs/tags/$LOOM_TAG" 2>/dev/null || true)"
if [ -z "$resolved_line" ]; then
  fail "could not resolve refs/tags/$LOOM_TAG on $LOOM_REPO (network issue, or the tag no longer exists upstream)."
fi
# An annotated tag's ls-remote line is the tag object's own sha, not the
# commit it points at — dereference via the refs/tags/<tag>^{} peeled line
# when present, otherwise the lightweight-tag sha above already *is* the
# commit sha.
peeled_line="$(git ls-remote --tags "$LOOM_REPO" "refs/tags/$LOOM_TAG^{}" 2>/dev/null || true)"
if [ -n "$peeled_line" ]; then
  resolved_sha="$(printf '%s' "$peeled_line" | awk '{print $1}')"
else
  resolved_sha="$(printf '%s' "$resolved_line" | awk '{print $1}')"
fi

if [ "$resolved_sha" != "$LOOM_EXPECTED_SHA" ]; then
  fail "refs/tags/$LOOM_TAG on $LOOM_REPO now resolves to $resolved_sha, expected $LOOM_EXPECTED_SHA.
  The tag moved (force-pushed upstream) since this script was last verified against it.
  Do not silently vendor unverified content — inspect the new commit, then update
  LOOM_EXPECTED_SHA in scripts/vendor-loom.sh (and re-check the Dockerfile/context
  assumptions in loom-backend.component.ts / loom-frontend.component.ts still hold)."
fi
notice "refs/tags/$LOOM_TAG verified at $resolved_sha"

if [ -d "$VENDOR_DIR" ]; then
  notice "removing existing $VENDOR_DIR for a clean re-fetch"
  rm -rf "$VENDOR_DIR"
fi
mkdir -p "$VENDOR_DIR"

notice "sparse-checkout of backend/, frontend/, agents/ at $LOOM_TAG into $VENDOR_DIR ..."
git -C "$VENDOR_DIR" init -q
git -C "$VENDOR_DIR" remote add origin "$LOOM_REPO"
# Fetch the tag ref itself (not a raw sha) — always supported, unlike
# fetching an arbitrary commit sha, which needs
# `uploadpack.allowReachableSHA1InWant` on the remote. `^{commit}` peels an
# annotated tag object down to the commit it points at (a no-op for a
# lightweight tag, which already names the commit directly).
git -C "$VENDOR_DIR" fetch --quiet --depth 1 origin "refs/tags/$LOOM_TAG"
fetched_sha="$(git -C "$VENDOR_DIR" rev-parse 'FETCH_HEAD^{commit}')"
if [ "$fetched_sha" != "$LOOM_EXPECTED_SHA" ]; then
  fail "fetched commit $fetched_sha does not match expected $LOOM_EXPECTED_SHA — aborting."
fi
git -C "$VENDOR_DIR" sparse-checkout init --cone
git -C "$VENDOR_DIR" sparse-checkout set backend frontend agents
git -C "$VENDOR_DIR" checkout --quiet "$fetched_sha"

for required in backend/Dockerfile frontend/Dockerfile agents/strands_agent/src agents/strands_agent/requirements.txt; do
  [ -e "$VENDOR_DIR/$required" ] || fail "expected $VENDOR_DIR/$required after checkout but it's missing — Loom's layout may have changed at $LOOM_TAG."
done

notice "done — $VENDOR_DIR is Loom $LOOM_TAG ($LOOM_EXPECTED_SHA), sparse-checked-out to backend/, frontend/, agents/."
notice "loom-backend's docker-build context is the vendor/loom root (its Dockerfile COPYs agents/strands_agent/ too — see loom-backend.component.ts); loom-frontend's is vendor/loom/frontend."
