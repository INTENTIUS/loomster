---
skill: loomster
description: Drive a Loom deployment on chant — deploy a tier, seed it, validate every screen, back it up, reconcile drift. The capability map for agents operating this repo.
user-invocable: true
---

# Operating loomster

loomster deploys [awslabs/loom](https://github.com/awslabs/loom) `v1.6.0` as typed
infrastructure on chant. You drive it from this repo — clone, install, then run
the verbs below. Nothing in `src/` changes between runs; two parameters do the
varying:

- **`LOOM_TIER`** — `light` | `production` | `production-ha`.
- **Target** — Floci (a local AWS emulator, no account) or a real AWS account.

chant is the CLI. It also serves an MCP server (`chant serve mcp`, stdio) exposing
`build` / `lint` / `list` / `describe` / `diff` / Op tools — wire it into your
agent to inspect and build the graph directly. This skill is the layer above that:
the lifecycle a Loom operator actually runs.

## Golden paths

Pick the cheapest one that answers the question in front of you.

1. **Local (no AWS account).** `just local-up` builds Loom's real images and stands
   the full app on Floci at `http://localhost:8080`. `just local-down` tears it
   down. Use for every "does it work" question that doesn't need a real account.
2. **Light on real AWS.** The cheapest self-contained real deployment — a real ALB,
   RDS, and Cognito. This is the only tier applied to a live account today.
3. **Production / production-ha.** HTTPS, a custom domain, PrivateLink, Multi-AZ.
   These synthesize and pass the fidelity audit, and deploy end to end on Floci
   (`just production-floci-e2e`), but haven't been applied to a live account yet.

## Command map

| Goal | Command | Notes |
|---|---|---|
| Run the full app locally | `just local-up` / `just local-down` | Floci, no AWS account |
| Synthesize a stack | `npm run synth` | writes `dist/*.template.json` |
| Typecheck / lint / test | `just check` | run before every deploy |
| Set up a custom domain | `LOOM_DOMAIN_NAME=<domain> npm run dns-setup` | creates + waits for Route53 delegation; do the NS step at your provider |
| Deploy a component | `chant run <op>` or the component pipeline | tier via `LOOM_TIER` |
| Seed the app | `npm run seed` | **via Loom's API, never the DB** — see Guardrails |
| Prove it's usable | `npm run validate` | walks every screen; the deploy gate |
| Back up | `npm run backup` + `npm run cognito-export` | RDS snapshot + Cognito export |
| Verify a backup restores | `npm run restore-drill` | restores to a throwaway instance, asserts health, deletes it — non-destructive |
| Restore | `npm run restore` | gated cutover; see `operations/backup-restore.md` |
| Reconcile cloud → code | `npm run reconcile` | opens a PR, never mutates the cloud |
| Audit the CI YAML | `just audit` | security audit of the generated pipeline |
| Tear down | `chant run loom-teardown` | |

Discover the rest with `chant list` (entities), `chant run list` (Ops + status),
and `chant describe <component>` (effective config for one stack).

## Deploy sequence

Components deploy in dependency order (`chant list --components` shows the wave
order): `shared-foundation` and `loom-cognito` first, then `loom-db`,
`loom-frontend`, `loom-backend`, then `loom-agents`. Cross-stack values resolve
through `stackOutput(...)`, so you set inputs once. After the stacks are up, the
app database is nearly empty — **seed, then validate**.

## Seeding

A fresh Loom's own database seeds almost nothing: no IAM role or authorizer in the
Security screen, so no agent can be created. `npm run seed` registers what loomster
provisioned into Loom through **Loom's own API**. Profiles:

- **`foundation`** (prod default) — the config floor: agent-role import, Cognito
  authorizer, loomster tag profile. Nothing invented.
- **`demo`** (light default) — foundation plus catalog entries, the Security tabs,
  and a few runtime invocations, so every screen has something real to show.
- **`none`** — skip.

Override with `LOOM_SEED_PROFILE`. `npm run validate` fails if any screen a profile
claims to seed comes up empty.

## Adoption (bring your own infrastructure)

Every referenceable piece exposes `provision | reference-existing | omit`, set from
`LOOM_*` env vars, with no forking of a composite:

- Network — `LOOM_VPC_ID`, `LOOM_PUBLIC_SUBNET_IDS`, `LOOM_PRIVATE_SUBNET_IDS`
- DNS — `LOOM_HOSTED_ZONE_ID`, `LOOM_CERTIFICATE_ARN` (`LOOM_ROUTE53`/`LOOM_ACM=omit` to drop)
- KMS / ECR / agent role — `LOOM_KMS_KEY_ARN`, `LOOM_{FRONTEND,BACKEND}_REPOSITORY_URI`/`_ARN`, `LOOM_AGENT_ROLE_ARN`
- IAM — `LOOM_BACKEND_EXECUTION_ROLE_ARN`, `LOOM_BACKEND_TASK_ROLE_ARN`, `LOOM_FRONTEND_EXECUTION_ROLE_ARN`

`src/examples/byo/` wires every seam to `reference-existing` at once. Full matrix:
`docs-site/.../adoption/overview.md`.

## Guardrails

- **Seed through Loom's API, never direct DB writes.** `ops/lib/seed.ts` uses
  Loom's endpoints. A direct write drifts from what the app believes.
- **Never seed an Identity Provider.** Creating an active IdP switches off Loom's
  dev-auth bypass and locks every request (and the API) behind real OIDC. Recovery
  means deleting the `identity_providers` row and restarting the backend. Leave the
  IdP screen empty; it renders fine unseeded.
- **Invoking an agent locally returns a canned stub, not real reasoning.** The Floci
  image emulates the AgentCore control plane, so agents reach `CREATE_COMPLETE` and
  are manageable, but real execution needs AgentCore on a live account.
- **`production` / `production-ha` haven't been applied to a live account.** Trust
  the Floci E2E and the fidelity audit for those tiers; don't claim a live prod apply.
- **Run `just check` before any deploy**, and `npm run validate` after — a deploy
  that serves but has empty screens is not done.
