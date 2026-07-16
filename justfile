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

# Fetch awslabs/loom's application source (pinned v1.6.0) into vendor/loom/
# (gitignored) — the docker-build context loom-backend/loom-frontend need for
# a real `chant run` deploy. Not required for build/lint/test/synth.
vendor:
    npm run vendor

# Synthesize the CFN templates (dist/*.template.json) + the lifecycle Ops'
# worker code + temporal-setup.sh (dist/temporal-manifest.txt, dist/schedules/).
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
# Observe: one-shot `chant lifecycle diff --live` across every stack this
# build targets (chant#904). Scheduled form needs Temporal — see ops/loom-watch.op.ts.
watch:
    npm run watch

# Reconcile (cloud → code, owned-only): opens a PR when live drifts from
# source (chant#904). Never commits to main — see ops/loom-reconcile.op.ts.
reconcile:
    npm run reconcile

# Supply-chain audit of this repo's own emitted GitHub Actions workflows
# (chant#906) — live resolution against upstream truth, report mode. See
# ops/loom-audit.op.ts.
audit:
    npm run audit

# Regenerate .gitlab-ci.yml from the discovered components (chant#892) and
# diff it against the committed copy — fails if they've drifted.
gitlab-validate:
    npx chant build --components --generate gitlab -o .gitlab/components.yml
    git diff --exit-code .gitlab/components.yml

# Regenerate .github/workflows/components.yml from the discovered components
# and diff it against the committed copy — fails if they've drifted. The same
# drift is gated in CI by src/github-pipeline.test.ts's no-drift test.
github-validate:
    npx chant build --components --generate github -o .github/workflows/components.yml
    git diff --exit-code .github/workflows/components.yml

# Regenerate .forgejo/workflows/components.yml and diff against the committed
# copy — fails on drift. Also gated by src/forgejo-pipeline.test.ts.
forgejo-validate:
    npx chant build --components --generate forgejo -o .forgejo/workflows/components.yml
    git diff --exit-code .forgejo/workflows/components.yml

# Run a chant-generated GitLab pipeline in Docker (gitlab-ci-local; on-demand,
# needs Docker) — see test/gitlab-runtime-e2e.sh. Not part of `check`.
gitlab-runtime-e2e:
    bash test/gitlab-runtime-e2e.sh

# Run the chant-generated GitHub Actions workflow in Docker (act; on-demand,
# needs Docker + act) — see test/github-runtime-e2e.sh. Not part of `check`.
github-runtime-e2e:
    bash test/github-runtime-e2e.sh

# Run the chant-generated Forgejo Actions workflow in Docker (act; on-demand,
# needs Docker + act) — see test/forgejo-runtime-e2e.sh. Not part of `check`.
forgejo-runtime-e2e:
    bash test/forgejo-runtime-e2e.sh

# Everything CI-relevant.
check: build lint test

# Local run — browsable Loom on a laptop (#49, epic #45). On-demand, needs Docker.
local-up:
    bash scripts/local/local-up.sh

local-down:
    bash scripts/local/local-down.sh
