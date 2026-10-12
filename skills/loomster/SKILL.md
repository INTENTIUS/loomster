---
skill: loomster
description: Drive a Loom deployment on chant: run it locally, deploy a tier, seed it, validate every screen, back it up, reconcile drift. The capability map for agents operating this repo.
user-invocable: true
---

# Operating loomster

loomster deploys [awslabs/loom](https://github.com/awslabs/loom) `v1.9.0` as typed
infrastructure on chant. You drive it from this repo: clone, `npm install`, then
run the verbs below. Nothing in `src/` changes between runs; two settings vary:

- `LOOM_TIER`: `light`, `production` or `production-ha`.
- The target: Floci (a local AWS emulator, no account) or a real AWS account.

chant is the CLI. It also serves an MCP server (`chant serve mcp`, stdio) with
`build`, `lint`, `list`, `describe`, `diff` and the Op tools. This skill is the
layer above: the lifecycle a Loom operator runs. The docs are at
https://intentius.io/loomster/ and https://intentius.io/loomster/llms.txt lists
every page; each task page has a prompt for you.

## Paths, cheapest first

1. Local, no AWS account. `just local-up` builds Loom's images and runs the app on
   Floci at `http://localhost:8080` with a real Cognito login (it prints the
   password); `just validate` checks every screen; `just local-down` stops it.
   Use it for every question that doesn't need a real account.
2. Light on AWS. The cheapest real deployment: an ALB, RDS and Cognito, on a VPC
   it builds. Only when the person asked for a deploy to their account.
3. Production or production-ha. HTTPS on a custom domain, PrivateLink, RDS
   Proxy, Multi-AZ on production-ha. Needs the person's VPC and domain.

All three have run end to end on a real account; the status, with what no run
has shown, is https://intentius.io/loomster/reference/validation/. A deployed
pool starts with no users: for the web app, add an admin as
https://intentius.io/loomster/guides/add-the-first-admin/ shows; for the API,
`just cognito-token` mints a throwaway admin's token on any tier.

## Command map

| Goal | Command | Notes |
|---|---|---|
| Run the app locally | `just local-up` / `just local-down` | Floci, no AWS account |
| Typecheck, lint, test | `just check` | before every change; `npm run lint:docs` for the docs |
| Synthesize | `npm run synth` | writes `dist/*.template.json` |
| First deploy in an account | `just bootstrap` | the ECS and AgentCore service-linked roles |
| Deploy | `npx chant run --components all --env <env>` | one component: `--components <name>` |
| Custom domain | `LOOM_DOMAIN_NAME=<domain> npm run dns-setup` | creates the zone, waits for the NS delegation |
| Seed | `npm run seed` | through Loom's API; needs `LOOM_API_BASE_URL` and `LOOM_API_TOKEN` off the local stack |
| Validate | `npm run validate` / `just validate` | every screen; the deploy is done when this passes |
| An agent's own role | `just agent-role <agent> <group>` | deploys the role stack and registers it in Loom |
| Back up | `npm run backup`, `npm run cognito-export` | RDS snapshot, Cognito users |
| Prove a backup restores | `npm run restore-drill` | throwaway instance, deleted after; no gate |
| Restore | `npm run restore` | stops at a gate before the cutover |
| Drift | `npm run watch`; `npm run reconcile` | reconcile opens a PR, never changes the cloud |
| Tunnel to the database | `just tunnel-host`, then `just tunnel` | optional SSM host |
| Loom's operator make targets | `just credentials`, `just memory ...`, `just fix-sequences`, `just cognito-token`, `just cognito-client-id` | `reset-db`, `import-sqlite`, `credentials-delete`, `set-passwords` are never over MCP: a person runs and approves them |
| Audit the CI YAML | `just audit` | |
| Tear down | `chant run loom-teardown` | stops at a gate |

`chant run list` shows every Op and its last run; `chant describe <component>`
shows one stack's effective config.

## Seeding

A fresh Loom database holds almost nothing, so the Security screen has no IAM
role or authorizer and no agent can be deployed. `npm run seed` registers what
loomster provisioned through Loom's own API. Profiles (`LOOM_SEED_PROFILE`):

- `foundation`, the production tiers' default: the agent role, a Cognito
  authorizer, a `loomster` tag profile. Nothing billable.
- `demo`, light's default: foundation plus an agent, a memory, an MCP server, an
  A2A agent, an approval policy, a few invocations, an evaluation test case and
  run, and a skill when a registry is set. Billable on a real account.
- `none`.

Loom's screens (v1.9.0 sidebar): Catalog; Agents (tabs Details, Invoke,
Evaluations), Memory, Integrations (MCP Servers, A2A Agents), Skills; Security
(Identity providers, IAM roles, Authorizers, Approval policies), Analytics
(Costs, User activity); Settings (General, Models, Networking, Infrastructure,
Tagging). Rows without a `loom:group` tag are visible to super-admins only; the
seed tags everything `loom:group=loomster` (`LOOM_SEED_GROUP`).

## Adoption

Every replaceable piece takes `provision`, `reference-existing` or `omit` through
`LOOM_*` variables, without forking a composite: network (`LOOM_VPC_ID`,
`LOOM_PUBLIC_SUBNET_IDS`, `LOOM_PRIVATE_SUBNET_IDS`), DNS
(`LOOM_HOSTED_ZONE_ID`, `LOOM_CERTIFICATE_ARN`), KMS, ECR, the agent role, the
backend and frontend roles, the database (`LOOM_DB_MODE`) and Cognito
(`LOOM_COGNITO_MODE`). The matrix is
https://intentius.io/loomster/reference/adoption-seams/ and every variable is in
https://intentius.io/loomster/reference/parameters/.

## Guardrails

- Never run `chant approve` or `just grant`; a person approves gates and grants
  claim runs.
- Never deploy to or delete from a real AWS account unless the person asked for
  that in this session. Confirm the account with `aws sts get-caller-identity`
  first.
- Seed through Loom's API, never with direct database writes.
- Never register an identity provider. An active one takes over Loom's login
  page, and with no real IdP behind it nobody can sign in through the page. The
  API still accepts Cognito tokens, so recovery is deleting the provider with a
  token from `just cognito-token`
  (https://intentius.io/loomster/guides/recover-from-an-idp-lockout/).
- Never push or edit the `chant/lifecycle` branch.
- Invoking an agent on Floci returns a canned reply; real reasoning needs AWS.
- Run `just check` before a change and `npm run validate` after a deploy. A
  deploy that serves but has empty screens isn't done.
