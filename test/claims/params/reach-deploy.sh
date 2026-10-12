#!/usr/bin/env bash
# target: static
# tier: any
# summary: LOOM_DB_PASSWORD set in the environment reaches the loom-db template that `chant run --components` hands to cfn-deploy
#
# `chant run --components` has no dry run (chant answers `--report` with
# "No preview/dry-run mode exists yet for the component driver", chant#1116).
# So this claim calls the same entry point the CLI handler calls,
# runComponents from @intentius/chant/components, with build params resolved
# the way `chant run` resolves them and the project's own capability
# registry, and swaps only the cfn-deploy capability for one that records
# the template file it was given instead of calling CloudFormation. Every
# other step of loom-db's deploy composition runs for real.
#
# cfn-deploy reads dist/loom-db.template.json from disk; chant never
# synthesizes it during a component run. To prove the run builds its own
# template rather than reusing one already in dist/, a stale template without
# the password is put there first (the old file is restored afterwards).
#
# BREAK=1 runs with LOOM_DB_PASSWORD unset, so the password cannot be there.
set -euo pipefail

name=params/reach-deploy
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[ -x node_modules/.bin/chant ] || { say pending "node_modules/.bin/chant is missing: run npm ci"; exit 0; }
[ -x node_modules/.bin/tsx ] || { say pending "node_modules/.bin/tsx is missing: run npm ci"; exit 0; }
command -v jq >/dev/null 2>&1 || { say pending "needs jq"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-deploy.XXXXXX")"
tpl="dist/loom-db.template.json"
had_tpl=""
mkdir -p dist
if [ -f "$tpl" ]; then cp "$tpl" "$work/saved.json"; had_tpl=1; fi
restore() {
  if [ -n "$had_tpl" ]; then cp "$work/saved.json" "$tpl"; else rm -f "$tpl"; fi
  rm -rf "$work"
}
trap restore EXIT
echo '{"Resources":{"stale":{"Type":"AWS::CloudFormation::WaitConditionHandle"}}}' >"$tpl"

sentinel="claimDeployPw$(date +%s)x9"
if [ -n "${BREAK:-}" ]; then
  unset LOOM_DB_PASSWORD
else
  export LOOM_DB_PASSWORD="$sentinel"
fi
export CLAIM_OUT="$work/deploys.json"

# The run, minus CloudFormation. stackOutput() inputs from shared-foundation
# are seeded the way `--seed-outputs` seeds them in a CI job.
if ! PATH="$ROOT/node_modules/.bin:$PATH" node_modules/.bin/tsx -e '
(async () => {
const { writeFileSync, readFileSync } = await import("node:fs");
const chant = await import("@intentius/chant");
const { buildCapabilityRegistry, CapabilityRegistry, runComponents } = await import("@intentius/chant/components");
const { resolveCliBuildParams, parseParamFlags } = await import("@intentius/chant/cli/build-params-cli");
const root = process.cwd();
const { config } = await chant.loadChantConfig(root);
const params = resolveCliBuildParams(config.buildParams, { cli: parseParamFlags(undefined) });
if (!params.success) throw new Error(params.errors.join("\n"));
const real = await buildCapabilityRegistry({
  plugins: config.capabilities,
  lexicons: (config.lexicons ?? []).map((l) => (typeof l === "string" ? l : l.name)),
});
const registry = new CapabilityRegistry();
for (const kind of real.kinds()) if (kind !== "cfn-deploy") registry.register(real.resolve(kind));
const deploys = [];
registry.register({
  kind: "cfn-deploy",
  async run(ctx, input) {
    deploys.push({ component: ctx.component, stack: input.stack, template: input.template, body: readFileSync(input.template, "utf8") });
    return { stackStatus: "CREATE_COMPLETE", outputs: {} };
  },
});
const result = await runComponents(root, "loom-db", {
  env: process.env.LOOM_ENV ?? "dev",
  registry,
  buildParams: params.provenance,
  componentOutputs: { "shared-foundation": { oVpcId: "vpc-claim", oPrivateSubnetIds: "subnet-a,subnet-b", oEcsSecurityGroupId: "sg-claim" } },
});
writeFileSync(process.env.CLAIM_OUT, JSON.stringify({ success: result.success, error: result.error ?? null, deploys }));
})().catch((err) => { console.error(err); process.exit(1); });
' >"$work/run.log" 2>&1; then
  cat "$work/run.log" >&2
  say fail "the component run did not finish: $(grep -v '^\s*$' "$work/run.log" | tail -n 1)"
  exit 0
fi

problem=""
if ! jq -e '.success' "$CLAIM_OUT" >/dev/null; then
  problem="the loom-db run failed: $(jq -r '.error // "no error given"' "$CLAIM_OUT")"
elif [ "$(jq '[.deploys[] | select(.component == "loom-db")] | length' "$CLAIM_OUT")" = 0 ]; then
  problem="the loom-db run reached no cfn-deploy step"
elif jq -e '.deploys[] | select(.component == "loom-db") | .body | contains("WaitConditionHandle")' "$CLAIM_OUT" >/dev/null; then
  problem="cfn-deploy got the stale template already in dist/: the run does not synthesize loom-db"
elif ! jq -e --arg s "$sentinel" '.deploys[] | select(.component == "loom-db") | .body | contains($s)' "$CLAIM_OUT" >/dev/null; then
  problem="LOOM_DB_PASSWORD is not in the template cfn-deploy got"
fi

if [ -n "${BREAK:-}" ]; then
  if [ -n "$problem" ]; then say caught "with LOOM_DB_PASSWORD unset: $problem"
  else say fail "the password reached the deploy with LOOM_DB_PASSWORD unset"; fi
elif [ -n "$problem" ]; then
  say fail "$problem"
else
  say pass "the template cfn-deploy got for loom-db was synthesized in the run and holds LOOM_DB_PASSWORD"
fi
