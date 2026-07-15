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

# Synthesize the shared-foundation + downstream-stub CFN templates into dist/.
synth:
    npm run synth

# Optional: per-component monthly cost estimate via Infracost, run against
# dist/*.template.json (chant#896). Opt-in — no-op (exit 0 + notice) if
# infracost isn't installed. Run `just synth` first.
estimate-cost:
    npm run estimate-cost

# Compile the lifecycle Ops (chant#905) to generated Temporal worker code
# under ops/dist/ops/ — workflow.ts/activities.ts/worker.ts per Op. Needs
# `--temporal` at `chant run` time only for the gated Ops (loom-upgrade-
# production[-ha], loom-rotate-*, loom-teardown); loom-upgrade-light runs on
# the local executor with no build step required.
ops-build:
    npm run ops:build

# Everything CI-relevant.
check: build lint test
