---
title: Screens
description: Every Loom v1.9.0 screen after a loomster deploy, what backs it, what each seed profile puts there, what stays empty on purpose, and the validation check that holds it.
---

A fresh Loom database holds almost nothing: Loom's own startup seeds the three
platform tags and a few demo tag profiles. So after a deploy most screens are
empty, and the Security screen's role and authorizer lists, which an agent
deploy needs, are blank. `loom-seed` fills them through Loom's own API, and
`just validate` checks every screen against the profile. This page maps each
screen to both, in the order of Loom's sidebar.

## Seed profiles

`LOOM_SEED_PROFILE` picks the profile; each [tier](/loomster/concepts/tiers-and-instances/)
has a default.

| Profile | Default on | Writes |
|---|---|---|
| `foundation` | `production`, `production-ha` | The shared agent role (imported), a Cognito authorizer, a `loomster` tag profile. Enough to deploy an agent; nothing billable |
| `demo` | `light` | `foundation`, plus a deployed agent, a memory, an MCP server, an A2A agent (given a reachable endpoint), an approval policy, a few agent invocations, an evaluation test case and one run, and a skill when a registry is configured |
| `none` | | Nothing beyond Loom's own startup |

Every record the seed creates carries `loom:application=loomster`,
`loom:owner=loomster` and `loom:group=loomster` (`LOOM_SEED_GROUP` overrides the
group), and names start with `Loomster` or `loomster`. Since Loom v1.9.0 a row
without a `loom:group` tag is visible to super-admins only, so the group tag is
what lets a group's members see the seeded rows. On a live account `demo`
creates billable resources: the agent, the memory, the invocations and the
evaluation. [Seed and validate a deploy](/loomster/guides/seed-and-validate/)
has the commands.

## Home

### Catalog

The Platform Catalog lists Agents, Memory Resources, MCP Servers and A2A Agents,
and a Skills section when an Agent Registry is configured; the Agents table has
a Registry column for each agent's registry status. On `demo` every section has
an entry. On `foundation` none is seeded, because deploying an agent or creating
a memory costs money on a live account.

## Build

### Agents

`demo` deploys `loomster_demo_agent` through Loom's own deploy path (build
artifact, S3, AgentCore runtime). Agent names must be identifier-style
(`[A-Za-z][A-Za-z0-9_]*`). The model is the first of Nova Lite, Nova Micro and
Nova Pro that the catalog lists for the region (as its `us.`, `eu.` or `apac.`
profile), falling back to the first listed model the region can invoke;
`LOOM_SEED_MODEL_ID` picks one outright. The harness needs at least one agent
`READY` or `CREATING`.

A new agent starts from a choice: the guided setup (Runtime, Identity and
models, Access, Tools and memory, Lifecycle and tags), importing a JSON
manifest, or registering an existing runtime by ARN. Agent detail has three
tabs:

- Details: the runtime, its role, endpoints and tags.
- Invoke: a chat against the agent. On [Floci](/loomster/concepts/glossary/#floci) it returns a canned reply.
- Evaluations: saved test cases (a prompt, the evaluators that score it, a pass
  threshold), their runs, and the account's online evaluation configs and batch
  evaluations for the agent. `demo` saves one test case scored by AWS's
  `Builtin.Helpfulness` evaluator and runs it once. A run invokes the agent,
  waits for its trace spans in CloudWatch, then scores them, so the score lands
  a few minutes after the seed. Scoring needs CloudWatch Transaction Search on
  (it writes `aws/spans`). Floci doesn't emulate Evaluations: test cases work,
  but the evaluator list and runs return `502` locally.

### Memory

`demo` creates one memory with a summary strategy, so it processes events
instead of sitting inert. It's a real AgentCore resource on a live account.

### Integrations

Two tabs. MCP Servers: `demo` registers a sample server; the create call doesn't
check the endpoint, so a placeholder URL works. A2A Agents: registering fetches
the agent card, so it needs a reachable endpoint. `just local-up` serves a card
from its proxy and sets `LOOM_DEMO_A2A_URL`; elsewhere set that variable to a
real A2A agent, or the tab stays empty.

### Skills

Skills are SKILL records in an AWS Agent Registry: a `SKILL.md` body Loom folds
into an agent's system prompt once the skill is attached and approved.
CloudFormation has no Agent Registry resource, so loomster doesn't create one;
point Loom at yours with `LOOM_REGISTRY_ID` at deploy time, or under Settings >
Infrastructure. With a registry configured, `demo` creates
`loomster-demo-skill`, approves it and attaches it to the demo agent, which picks
it up on its next redeploy. With none, Skills is empty.

## Operate

### Security

Four tabs.

- Identity providers: never seeded. Registering a provider switches Loom's
  login page to it; with no real IdP behind it nobody can sign in through the
  page. The harness checks the tab renders and is empty.
  [Recover from an IdP lockout](/loomster/guides/recover-from-an-idp-lockout/)
  undoes one.
- IAM roles: `foundation` imports the shared agent role by ARN. Loom only
  imports roles; it never creates them. Without one, the new-agent role picker
  is empty. Per-agent roles from `loom-agent-role` land here too.
- Authorizers: `foundation` registers a Cognito authorizer for loomster's pool,
  so agents can use OAuth2 with it.
- Approval policies: `demo` adds one notify-only policy. Approval policies carry
  no group, so everyone with `security:read` sees them. The approval log fills
  when an agent's tool call meets a policy, so it is checked to render only.

### Analytics

Two tabs, Costs and User activity, computed from real invocation records. They
stay empty until agents run. `demo` invokes the demo agent a few times once it
is `READY`, so the costs are real if small; on `foundation` that is skipped. The
harness needs at least one recorded invocation on `demo`.

## System

### Settings

Settings is configuration, and its empty states are correct defaults.

- General: language (English or Japanese), theme (light or dark), time zone, and
  Loom's defaults such as the CPU idle discount.
- Models: the enabled-models list starts empty, which means every model is
  allowed; it restricts the catalog when filled. The Refresh button
  (`POST /api/settings/models/refresh`) fails on a deployed loomster, and on
  Loom's own ECS deploy: it rewrites `etc/models.json` inside the container,
  which the image leaves read-only to the user the backend runs as, and the
  image lacks the `etc/bedrock_model_catalog.json` it reads, so it answers 500.
  A writable copy would still be one task's, lost on restart and different
  across production-ha's two tasks. The model list is the `models.json` Loom
  ships with each release, so a newer list arrives with a Loom bump. Models an
  agent already uses stay usable after they leave the list.
- Networking: VPC configurations the UI uses to deploy an agent into a VPC.
  Empty is right on light, whose agents run `PUBLIC`. On the production tiers
  the chant-managed assistant carries its VPC settings in its template; add a
  configuration only for VPC-mode agents you deploy from the UI.
- Infrastructure: the Agent Registry. Empty unless you set `LOOM_REGISTRY_ID`
  or enter one.
- Tagging: Loom's three locked platform tags and its demo tag profiles, plus the
  `loomster` tag profile from the seed.

## Validation checks

`just validate` (or `npm run validate`) runs these against `LOOM_API_BASE_URL`
with `LOOM_API_TOKEN`, minting a token against the local stack when none is set.
Every check needs a 200; "seeded" means the profile's content must be there.

| Check | Endpoint | Bar |
|---|---|---|
| Tagging — platform tags | `GET /api/settings/tags` | seeded |
| Tagging — tag profiles | `GET /api/settings/tag-profiles` | seeded |
| Security — IAM roles | `GET /api/security/roles` | seeded |
| Security — authorizers | `GET /api/security/authorizers` | seeded |
| Security — identity providers | `GET /api/settings/identity-providers` | empty |
| Security — approval policies | `GET /api/settings/approval-policies` | seeded on `demo` |
| MCP Servers | `GET /api/mcp/servers` | seeded on `demo` |
| A2A Agents | `GET /api/a2a/agents` | seeded on `demo` when an endpoint is set |
| Memory | `GET /api/memories` | seeded on `demo` |
| Agents (Builder) | `GET /api/agents` | on `demo`, at least one agent `READY` or `CREATING` |
| Costs | `GET /api/dashboard/costs` | on `demo`, at least one invocation |
| Admin (audit) | `GET /api/admin/audit/summary` | renders |
| Settings | `GET /api/settings/site` | renders |
| Registry | `GET /api/registry/records` | renders |
| Security — approval logs | `GET /api/settings/approvals/logs` | renders |
| Settings — models | `GET /api/settings/models` | renders |
| Settings — models refresh | `/api/settings/models/refresh` | the route exists; never pressed |
| Agents — model invoke-test | `/api/agents/models/invoke-test` | the route exists; never called |
| Settings — registry | `GET /api/settings/registry` | renders, and says whether a registry is configured |
| Skills | `GET /api/registry/records?descriptor_type=SKILL` | on `demo` with a registry, `loomster-demo-skill` APPROVED |
| Skills — dependents | `GET /api/registry/records/<id>/dependents` | on `demo` with a registry, lists the demo agent |
| Agents — evaluations | `GET /api/agents/<id>/evaluations` | renders |
| Agents — evaluators | `GET /api/agents/<id>/evaluations/evaluators` | renders |
| Agents — evaluation test cases | `GET /api/agents/<id>/evaluations/test-cases` | on `demo`, a test case that has run |

The check names are the harness's own labels in `scripts/validate/checks.ts`;
Costs and Admin (audit) are the two tabs of Analytics, and Agents (Builder) is
the Agents screen.
