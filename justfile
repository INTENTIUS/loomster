# loom-on-chant — production deployment of awslabs/loom on chant.
# `just` with no target lists everything.

default:
    @just --list

# Install dependencies (chant and its lexicons from npm) and the pre-push guard
# that keeps chant's lifecycle ledger (chant/lifecycle) off origin unless CI is
# set or LOOM_LEDGER_PUSH=1 (scripts/git-hooks/pre-push).
install:
    npm install
    bash scripts/install-git-hooks.sh

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

# Synthesize the CFN templates (dist/*.template.json) and build the lifecycle
# Ops (ops/dist/ops/<name>/op.json).
synth:
    npm run synth

# Optional: per-component monthly cost estimate via Infracost, run against
# dist/*.template.json (chant#896). Opt-in — no-op (exit 0 + notice) if
# infracost isn't installed. Run `just synth` first.
estimate-cost:
    npm run estimate-cost

# Build the lifecycle Ops (chant#905) to ops/dist/ops/<name>/op.json. Every Op
# runs in-process with `chant run <op>`. A gated Op (loom-upgrade-production[-ha],
# loom-rotate-*, loom-restore, loom-teardown) exits 3 at its gate until
# `chant approve <op> <gate>` records the approval on the chant/lifecycle
# ledger; the next `chant run <op>` continues.
ops-build:
    npm run ops:build

# Observe: one-shot `chant lifecycle diff --live` across every stack this
# build targets (chant#904). The CI-cron form is .github/workflows/watch.yml.
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

# Once per AWS account, before the first deploy: the ECS and AgentCore
# runtime-identity service-linked roles (Loom's make ecs.init/agentcore.init),
# created only if missing (#38).
bootstrap:
    npx chant run loom-bootstrap

# One Loom agent's execution role, the way Loom's role.yaml makes it: deploy the
# role stack and register it in Loom tagged into the group (#2).
# `just agent-role support_bot support`; LOOM_API_BASE_URL/LOOM_API_TOKEN as for loom-seed.
agent-role agent group:
    LOOM_AGENT_ROLE_AGENT={{agent}} LOOM_AGENT_ROLE_GROUP={{group}} npx chant run loom-agent-role

# The optional SSM tunnel host (Loom's ec2.yaml, #37), off unless you run this:
# deploys {project}-{env}-{instance}-tunnel-host into shared-foundation's private
# subnets. LOOM_TUNNEL_SSM_ENDPOINTS=true adds the SSM endpoints a subnet without NAT needs.
tunnel-host:
    npx chant run loom-tunnel-host

# Port-forward localhost:<port> to the database (RDS Proxy on production tiers)
# through the tunnel host, Loom's `make tunnel`. Runs until Ctrl-C.
tunnel port="5432":
    bash scripts/tunnel.sh {{port}}

# ── Loom's operator make targets (#39; docs reference/make-targets) ─────────
# Gated ones (import-sqlite, reset-db, credentials-delete) stop at their gate:
# `chant approve <op> approve-<op>`, then run the same verb again.

# make migrate: copy a SQLite Loom into this deployment's Postgres, then fix the sequences.
import-sqlite file:
    LOOM_IMPORT_SQLITE={{file}} npx chant run loom-import-sqlite

# make fix-sequences: reset the id sequences to each table's max id.
fix-sequences:
    npx chant run loom-fix-sequences

# make reset-db: snapshot, then wipe the database (gated, never over MCP).
reset-db:
    npx chant run loom-reset-db

# make agentcore.credentials.list: providers in the region, and the ones this Loom recorded.
credentials:
    npx chant run loom-credentials

# make agentcore.credentials.delete-all, owned-only: delete the providers this Loom recorded.
credentials-delete:
    npx chant run loom-credentials-delete

# `just memory`, `just memory get <id>`, `just memory records <id> <actor>`,
# `just memory records-by-namespace <id> <namespace>`, `just memory extraction-jobs <id>`.
# make agentcore.memory.*: inspect AgentCore memory (read-only).
memory query="list" id="" who="":
    LOOM_MEMORY_QUERY={{query}} LOOM_MEMORY_ID={{id}} LOOM_MEMORY_ACTOR_ID={{who}} LOOM_MEMORY_NAMESPACE={{who}} npx chant run loom-memory

# LOOM_COGNITO_PASSWORD=... just set-passwords [alice,bob]; no users means every
# one still in FORCE_CHANGE_PASSWORD.
# make cognito.set-passwords: set a permanent password for first sign-in.
set-passwords users="":
    LOOM_COGNITO_USERS={{users}} npx chant run loom-cognito-set-passwords

# make cognito.get-client-id: the user and M2M app-client ids from the loom-cognito stack.
cognito-client-id:
    @aws cloudformation describe-stacks --stack-name "${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}-loom-cognito" --query "Stacks[0].Outputs[?OutputKey=='oUserClientId' || OutputKey=='oM2MClientId'].[OutputKey,OutputValue]" --output text

# A throwaway admin user, MFA handled; `just cognito-token --delete` removes it.
# export LOOM_API_TOKEN=$(just cognito-token)
# make cognito.get-tokens: an admin access token for Loom's API.
cognito-token *args:
    @bash scripts/validate/get-user-token.sh {{args}}

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
