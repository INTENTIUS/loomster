#!/usr/bin/env bash
# target: static
# tier: any
# summary: on every tier the web app's image is built with loom-cognito's user client id (VITE_COGNITO_USER_CLIENT_ID), and that client allows the SPA's password sign-in
#
# The docs say the deployed web app signs in on every tier (#75): Loom's SPA
# needs the Cognito user client id baked in at build time and reads the pool
# from the backend. For light, production and production-ha this checks:
#   - loom-cognito's template declares the user client with
#     ALLOW_USER_PASSWORD_AUTH (the flow the SPA's form uses) and outputs it as
#     oUserClientId;
#   - every docker-build of loom-frontend passes
#     VITE_COGNITO_USER_CLIENT_ID from loom-cognito's oUserClientId, and
#     loom-frontend depends on loom-cognito so the id exists before the build.
# tier/light-live signs in through the served page on a live account.
#
# BREAK=1 builds with LOOM_COGNITO_MODE=reference-existing and no
# LOOM_COGNITO_USER_CLIENT_ID (a shared pool that names no user client), where
# the frontend gets no client id, and expects the check to name the gap.
set -euo pipefail

name=cognito/user-client
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[ -x node_modules/.bin/chant ] && [ -x node_modules/.bin/tsx ] || { say pending "node_modules is missing: run npm ci"; exit 0; }
command -v jq >/dev/null 2>&1 || { say pending "needs jq"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-user-client.XXXXXX")"
trap 'rm -rf "$work"' EXIT

mode_env=()
[ -z "${BREAK:-}" ] || mode_env=(LOOM_COGNITO_MODE=reference-existing LOOM_COGNITO_USER_POOL_ID=us-east-1_claimref)

# The frontend component's build args and dependencies, as chant sees them.
cat >"$work/frontend.ts" <<'TS'
import { loomFrontend } from "./src/components/loom-frontend.component";
const steps = [loomFrontend.build, ...loomFrontend.deploy.flatMap((p) => p.steps)]
  .filter((s: any) => s && (s === loomFrontend.build || s.kind === "docker-build"));
console.log(JSON.stringify({ dependsOn: loomFrontend.dependsOn, buildArgs: steps.map((s: any) => s.buildArgs ?? null) }));
TS

problems=""
note() { problems="$problems $*;"; }
for tier in light production production-ha; do
  # loom-cognito's template, as `npm run synth` builds it (the provisioned pool;
  # BREAK changes only what the frontend is told).
  if LOOM_TIER="$tier" LOOM_ENV=claims LOOM_INSTANCE=c0 \
      ./node_modules/.bin/chant build src/loom-cognito --lexicon aws -o "$work/cognito-$tier.json" >"$work/cognito-$tier.log" 2>&1; then
    flows="$(jq -c '[.Resources[] | select(.Type == "AWS::Cognito::UserPoolClient") | .Properties.ExplicitAuthFlows // [] | .[]]' "$work/cognito-$tier.json")"
    jq -e 'index("ALLOW_USER_PASSWORD_AUTH")' <<<"$flows" >/dev/null || note "$tier: no user pool client allows ALLOW_USER_PASSWORD_AUTH"
    jq -e '.Outputs.oUserClientId' "$work/cognito-$tier.json" >/dev/null || note "$tier: loom-cognito has no oUserClientId output"
  else
    note "$tier: chant build src/loom-cognito failed ($(tail -n 1 "$work/cognito-$tier.log"))"
  fi
  # The frontend build's args (the module reads the env when it loads).
  cp "$work/frontend.ts" "$ROOT/.claim-frontend-$$.ts"
  out="$(env "${mode_env[@]+"${mode_env[@]}"}" LOOM_TIER="$tier" LOOM_ENV=claims LOOM_INSTANCE=c0 \
    ./node_modules/.bin/tsx "$ROOT/.claim-frontend-$$.ts" 2>"$work/frontend-$tier.log" | tail -n 1 || true)"
  rm -f "$ROOT/.claim-frontend-$$.ts"
  if [ -z "$out" ]; then note "$tier: loading loom-frontend failed ($(tail -n 1 "$work/frontend-$tier.log"))"; continue; fi
  jq -e '.dependsOn | index("loom-cognito")' <<<"$out" >/dev/null || note "$tier: loom-frontend does not depend on loom-cognito"
  jq -e '(.buildArgs | length) > 0 and all(.buildArgs[]; .VITE_COGNITO_USER_CLIENT_ID.stackOutput == {stack: "loom-cognito", name: "oUserClientId"})' <<<"$out" >/dev/null \
    || note "$tier: a loom-frontend docker-build lacks VITE_COGNITO_USER_CLIENT_ID from loom-cognito's oUserClientId"
done

if [ -n "${BREAK:-}" ]; then
  if [ -n "$problems" ]; then problems="${problems# }"; say caught "with a shared pool that names no user client: ${problems%;}"
  else say fail "with a shared pool that names no user client, every tier still passed a user client id"; fi
  exit 0
fi
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "light, production and production-ha: the user client allows password sign-in, and every frontend build passes its id from loom-cognito's oUserClientId"; fi
