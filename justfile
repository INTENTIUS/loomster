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
# Regenerate .gitlab-ci.yml from the discovered components (chant#892) and
# diff it against the committed copy — fails if they've drifted.
gitlab-validate:
    npx chant build --components --generate gitlab -o .gitlab-ci.yml
    git diff --exit-code .gitlab-ci.yml

# Run a chant-generated GitLab pipeline in Docker (gitlab-ci-local; on-demand,
# needs Docker) — see test/gitlab-runtime-e2e.sh. Not part of `check`.
gitlab-runtime-e2e:
    bash test/gitlab-runtime-e2e.sh

# Everything CI-relevant.
check: build lint test
