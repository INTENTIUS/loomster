#!/usr/bin/env bash
#
# scripts/export-bundle.sh — exportable artifact bundle hand-off (chant#901).
#
# Third Loom-on-chant adoption on-ramp: consume the output, skip the tool.
# Synthesizes every real Loom component (see README.md's "Components" table)
# across all three tiers (light/production/production-ha), folds each
# template into chant's existing Build Archive manifest format (no new
# packaging — see scripts/export-bundle.ts's module doc), includes the
# generated GitHub + GitLab CI, and writes a README with the plain
# `aws cloudformation deploy` instructions + parameter reference.
#
# Usage:
#   npm run export-bundle
#
# Env:
#   EXPORT_PERSIST_LEDGER=true   also persist each tier's manifest to this
#                                repo's chant/lifecycle orphan branch (local
#                                git commit only — see persistTierManifestToLedger
#                                in export-bundle.ts). Off by default.
#   EXPORT_PUSH_LEDGER=true      (with EXPORT_PERSIST_LEDGER=true) also push
#                                that branch to the remote. Off by default.
#   LOOM_VPC_ID / LOOM_PUBLIC_SUBNET_IDS / LOOM_PRIVATE_SUBNET_IDS /
#   LOOM_DOMAIN_NAME / LOOM_DB_PASSWORD
#                                override this script's example placeholder
#                                values with a real deployment's own —
#                                see docs/adoption.md.
#
# Output: dist/bundle/loom-<version>/{light,production,production-ha}/ —
# see the generated README.md at the bundle root for the full layout.

set -euo pipefail
cd "$(dirname "$0")/.."

npx tsx scripts/export-bundle.ts
