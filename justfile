# loom-on-chant — production deployment of awslabs/loom on chant.
# `just` with no target lists everything.

default:
    @just --list

# Install dependencies (dev-linked chant via file: deps — see README).
install:
    npm install

# Typecheck the helper, composites, and project-local lint rules.
build:
    npx tsc --noEmit

# chant lint — core rules + project-local rules in .chant/rules/.
lint:
    npx chant lint .

# Unit tests (naming/tagging helper, collision tests, etc.).
test:
    npx vitest run

# Synthesize the CFN templates (dist/*.template.json) + the lifecycle Ops'
# worker code + temporal-setup.sh (dist/temporal-manifest.txt, dist/schedules/).
synth:
    npm run synth

# Optional: per-component monthly cost estimate via Infracost, run against
# dist/*.template.json (chant#896). Opt-in — no-op (exit 0 + notice) if
# infracost isn't installed. Run `just synth` first.
estimate-cost:
    npm run estimate-cost

# Observe: one-shot `chant lifecycle diff --live` across every stack this
# build targets (chant#904). Scheduled form needs Temporal — see ops/loom-watch.op.ts.
watch:
    npm run watch

# Reconcile (cloud → code, owned-only): opens a PR when live drifts from
# source (chant#904). Never commits to main — see ops/loom-reconcile.op.ts.
reconcile:
    npm run reconcile

# Everything CI-relevant.
check: build lint test
