# loom-on-chant — production deployment of awslabs/loom on chant.
# `just` with no target lists everything.

default:
    @just --list

# Install dependencies (chant and its lexicons from npm).
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

# Fetch awslabs/loom's application source (pinned v1.9.0) into vendor/loom/
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

# Deploy the production tier end to end against Floci and assert every
# tier-distinguishing resource (RDS Proxy, PrivateLink, ACM/Route53, autoscaling,
# both agents). On-demand, needs Docker; binds :4566 (run `just local-down`
# first). See test/production-floci-e2e.sh. Not part of `check`.
production-floci-e2e:
    bash test/production-floci-e2e.sh production

# Same as above for production-ha: + Multi-AZ RDS, credential rotation, 2-task floor.
production-ha-floci-e2e:
    bash test/production-floci-e2e.sh production-ha

# LIVE production E2E against a real AWS account — real ALB/RDS/PrivateLink/ACM +
# Bedrock AgentCore, live assertions, gated teardown. Needs real creds + a delegated
# custom domain (run `npm run dns-setup` first). Real cost. See the
# operations/production-live-e2e runbook and test/production-live-e2e.sh.
production-live-e2e:
    bash test/production-live-e2e.sh production

# Same, for production-ha (Multi-AZ RDS + rotation — materially more cost).
production-ha-live-e2e:
    bash test/production-live-e2e.sh production-ha

# Everything CI-relevant.
check: build lint test

# Local run — browsable Loom on a laptop (#49, epic #45). On-demand, needs Docker.
local-up:
    bash scripts/local/local-up.sh

local-down:
    bash scripts/local/local-down.sh

# Validate a running Loom screen by screen against the active seed profile.
# LOOM_API_BASE_URL (default the local-up proxy) + LOOM_SEED_PROFILE (default demo).
validate:
    npm run validate

# Claims (test/claims.sh, docs reference/claims): one per documented
# capability, each run plain and under BREAK=1. Static claims run as they are;
# floci and aws claims stop at the human gate unless a person types "run" or
# granted them (`just grant`). Rows land in test/.state/claims.json.
# `just claims` runs every claim; `just claims params,teardown/covers-components` some.
claims names="":
    bash test/claims.sh {{ if names == "" { "" } else { "--only " + names } }} --record test/.state/claims.json

# The claims the change since base can affect (test/claims-affected.sh says why).
claims-affected base="origin/main":
    bash test/claims.sh --affected {{base}} --record test/.state/claims.json

# A person grants a coding agent runs of named claims, areas or e2e/<name>
# (2 runs each, for 4 hours, by default): `just grant backend/deploy-agent --runs 1`.
# `just grant --show` lists what is left; `just grant --end` ends the grant.
grant +args:
    bash test/grant.sh {{args}}
