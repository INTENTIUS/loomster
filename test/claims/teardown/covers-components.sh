#!/usr/bin/env bash
# target: static
# tier: any
# summary: loom-teardown deletes every component in the component graph, each before the components it depends on
#
# `chant graph --components` is the component graph `chant run --components
# all` deploys. ops/lib/teardown-plan.ts's discoverTeardownOrder() is what
# loom-teardown deletes, in order. Every component must be in it, and every consumer must
# come before each of its producers.
#
# BREAK=1 drops the first component from the teardown order before checking,
# so the order no longer covers the graph.
set -euo pipefail

name=teardown/covers-components
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[ -x node_modules/.bin/chant ] || { say pending "node_modules/.bin/chant is missing: run npm ci"; exit 0; }

graph="$(NO_COLOR=1 ./node_modules/.bin/chant graph --components 2>/dev/null | tr -d '\033' | sed 's/\[[0-9;]*m//g')" \
  || { say fail "chant graph --components failed"; exit 0; }
# "  1. loom-cognito, shared-foundation" lines under "Deploy order".
components="$(awk '/^Deploy order/ { on = 1; next } on && /^ *[0-9]+\. / { sub(/^ *[0-9]+\. /, ""); gsub(/, */, "\n"); print; next } on && NF == 0 { exit }' <<<"$graph" | grep . | sort -u)"
# "  consumer → producer" lines under "Dependencies".
deps="$(awk '/^Dependencies/ { on = 1; next } on && NF == 3 { print $1, $3 }' <<<"$graph")"
[ -n "$components" ] || { say fail "chant graph --components listed no components"; exit 0; }

order="$(./node_modules/.bin/tsx -e 'import("./ops/lib/teardown-plan.ts").then((m) => m.discoverTeardownOrder()).then((o) => console.log(o.join("\n")));' 2>/dev/null)" \
  || { say fail "could not read the order from ops/lib/teardown-plan.ts discoverTeardownOrder()"; exit 0; }
if [ -n "${BREAK:-}" ]; then
  dropped="$(head -n 1 <<<"$order")"
  order="$(tail -n +2 <<<"$order")"
fi

problems=""
missing="$(comm -23 <(echo "$components") <(sort -u <<<"$order") | paste -sd, -)"
[ -z "$missing" ] || problems="not in the teardown order: $missing;"
pos() { awk -v c="$1" '$0 == c { print NR; exit }' <<<"$order"; }
while read -r consumer producer; do
  [ -n "$consumer" ] || continue
  c="$(pos "$consumer")" p="$(pos "$producer")"
  [ -n "$c" ] && [ -n "$p" ] || continue
  [ "$c" -lt "$p" ] || problems="$problems $consumer is deleted after $producer, which it depends on;"
done <<<"$deps"

count="$(wc -l <<<"$components" | tr -d ' ')"
if [ -n "${BREAK:-}" ]; then
  if [ -n "$problems" ]; then say caught "with $dropped dropped: ${problems%;}"
  else say fail "dropping $dropped from the order went unnoticed"; fi
elif [ -n "$problems" ]; then
  say fail "${problems%;}"
else
  say pass "all $count components are in the teardown order, consumers first"
fi
