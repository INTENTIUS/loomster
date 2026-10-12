---
title: Screens
description: Every Loom screen after a loomster deploy — what backs it, what loom-seed populates on each profile, and what's deliberately left empty and why. The deployment reference that maps the running app to the seeding decisions behind it.
---

loomster is a deployment of [awslabs/loom](https://github.com/awslabs/loom). A
fresh deploy stands up the infrastructure, but the app also has to be *usable* —
and Loom's own database init seeds almost nothing, so most screens start empty.
The [`loom-seed`](/loomster/reference/seeding/) Op fills them through Loom's own
API.

This page is the map from the running app to those decisions: for every screen,
what data backs it, what each seed profile populates, and — where a screen is
left empty — why that's the right answer rather than a gap. The validation
harness (`npm run validate`) enforces exactly this, screen by screen.

Two seed profiles are referenced throughout: **`foundation`** (the config an
agent deploy needs — the default on the production tiers) and **`demo`**
(foundation plus explorable content — the default on `light`). See
[Seeded defaults](/loomster/reference/seeding/) for the mechanics.

## At a glance

| Screen | Backed by | `foundation` | `demo` | Empty by design |
|---|---|---|---|---|
| Tagging | tags, tag profiles | Loom's platform tags + a `loomster` profile | same | — |
| Security → IAM Roles | `managed_roles` | imported agent role | same | — |
| Security → Authorizers | `authorizer_configs` | Cognito authorizer | same | — |
| Security → Approval Policies | `approval_policies` | — | a default policy | on foundation |
| Security → Identity Providers | `identity_providers` | — | — | **always** (see below) |
| Agents | `agents` | — | a deployed agent | on foundation |
| Agent → Evaluations | test cases + AgentCore Evaluations | — | a test case, run once | on foundation |
| Memory | `memories` | — | a memory | on foundation |
| MCP Servers | `mcp_servers` | — | a sample server | on foundation |
| A2A Agents | `a2a_agents` | — | a registered agent | when no A2A endpoint |
| Catalog | the five above | — | populated | on foundation |
| Settings | app config | Loom defaults | Loom defaults | Networking / Infrastructure |
| Costs, Admin, Chat, Invocations | runtime (invocation records) | — | a few demo invocations | on foundation / until real use |
| Registry | AWS Agent Registry | — | — | until you configure a registry |
| Skills | SKILL records in the registry | — | an approved skill, attached to the demo agent | until you configure a registry |

## Tagging

Loom's own init seeds the three locked platform tags (`loom:application`,
`loom:group`, `loom:owner`) and a set of `demo-user-N` tag profiles. `loom-seed`
adds a **`loomster`** tag profile, and stamps every resource it creates with
`loom:application` and `loom:owner` set to `loomster` — so its records are
distinguishable from Loom's demo data and anything entered by hand.

## Security

Four tabs. Two are the floor an agent deploy needs; one is demo content; one is
deliberately never seeded.

- **IAM Roles** — `foundation` imports the shared-foundation agent execution
  role by ARN. Without a role here, the add-agent form's role picker is empty and
  no agent can be deployed. Loom only supports *importing* existing roles (it
  assumes security admins create them out of band), which is exactly what loomster
  provisions.
- **Authorizers** — `foundation` registers a Cognito authorizer pointed at the
  pool loomster provisions, so agents can use OAuth2/Cognito auth.
- **Approval Policies** — `demo` seeds one default *notify-only* policy, so the
  tab isn't empty and the approval flow is visible.
- **Identity Providers** — **never seeded.** Registering an identity provider
  switches Loom's login page to that provider: with no real IdP behind it,
  nobody can sign in and the app locks itself out. You add a real provider here on a real
  deploy; a seeded one would only break a local or demo run. The harness checks
  this tab renders, and asserts nothing is in it.

## Catalog and its sections

The Catalog aggregates four resource types. On `demo`, loom-seed populates every
one so the Catalog isn't a wall of empty sections:

- **Agents** — deploys one agent (`loomster_demo_agent`) via Loom's own deploy
  path (build artifact → S3 → AgentCore runtime). Names must be identifier-style
  (`[A-Za-z][A-Za-z0-9_]*`). The model is the first of Nova Lite, Nova Micro and
  Nova Pro that the catalog lists for the deploy region (its `us.`/`eu.`/`apac.`
  profile), falling back to the first listed model invocable there;
  `LOOM_SEED_MODEL_ID` picks one outright. The harness requires at least one agent that's `READY` or
  `CREATING` — an all-`FAILED` list means the deploy path is broken and fails
  validation.
- **Memory** — creates one memory resource with a **summary strategy**, so it
  actually processes events rather than sitting inert (a strategyless memory is
  valid but does nothing). Creating a memory calls Bedrock AgentCore; it's free
  on the Floci emulator but a real (billable) resource on a live account, which is
  why it's `demo`-only.
- **MCP Servers** — registers one sample server. The create call doesn't validate
  the endpoint, so a placeholder URL is fine.
- **A2A Agents** — registers one agent. Unlike MCP, registration *fetches* the
  agent card from the endpoint, so it needs a reachable one. `just local-up`
  serves a static card from its proxy and sets `LOOM_DEMO_A2A_URL`; without a
  reachable endpoint the A2A section is left for you to fill.

On `foundation`, none of the Catalog is seeded — deploying an agent or creating a
memory costs money on a live account, so the production tiers stay lean and leave
that to you.

## Agent → Evaluations

Loom v1.8 added an **Evaluations** tab to agent detail: saved test cases (a
prompt, the evaluators that score it, a pass threshold), their runs, and any
online evaluation configs or batch evaluations in the account that cover the
agent. On `demo`, loom-seed saves one test case on the demo agent, scored by
AWS's built-in `Builtin.Helpfulness` evaluator, and starts one run. A run
invokes the agent, waits for the session's trace spans in CloudWatch, then
scores them, all in the background, so the score lands a few minutes after the
seed finishes. Scoring needs the spans: on a live account that means
CloudWatch Transaction Search is on (it writes `aws/spans`); on the emulator a
run can end in `ERROR` for want of spans, which is the emulator, not the
deploy. The harness checks the tab's three endpoints render and, on `demo`,
that the seeded test case exists and has run.

## Registry and Skills

The **AWS Agent Registry** is GA (Loom moved to its `agent-registry:*` IAM
namespace in v1.6.1), and loomster's backend task role carries those grants.
loomster doesn't create the registry itself: CloudFormation has no Agent
Registry resource yet, so it stays reference-existing. Point Loom at one with
`LOOM_REGISTRY_ID` at deploy time, or under Settings → Infrastructure on a
running deploy. With none configured, Registry and **Skills** render empty.

Skills (Loom v1.6.1 to v1.8) are SKILL records in that registry: a `SKILL.md`
body that Loom folds into an agent's system prompt when the skill is attached
to the agent and APPROVED. When a registry is configured, `demo` creates one
skill (`loomster-demo-skill`), approves it and attaches it to the demo agent;
the skill reaches the agent's prompt on its next redeploy. The harness then
requires that skill to be APPROVED and to list the demo agent among its
dependents.

## Settings

Settings is **configuration, not content** — and its empty states are correct
defaults, not gaps. Nothing here needs seeding.

- **General** — Loom serves working defaults (e.g. `cpu_io_wait_discount`) without
  needing seeded rows.
- **Models** — the enabled-models list starts empty, and that's intentional: it's
  an allow-list to *restrict* the catalog, so empty means "all models allowed."
  The agent picker uses the full catalog regardless. Seeding a curated list would
  override Loom's own default, not fix anything.
- **Models > Refresh** (`POST /api/settings/models/refresh`, Loom v1.8.0+) does not
  work on a deployed loomster, and does not on Loom's own ECS deploy either. It
  rewrites `etc/models.json` inside the container, which the image leaves
  root-owned and read-only to the `appuser` the backend runs as, and the image
  doesn't carry the `etc/bedrock_model_catalog.json` it reads; it answers 500.
  Even a writable copy would be task-local: lost on the next deploy or restart,
  and different on each of production-ha's two tasks. The model list comes from
  the `models.json` Loom ships with each release (refreshed by Loom's
  `make refresh-models` at release time), so a newer list arrives with a Loom
  bump (`npm run vendor` after moving the pinned tag). Grandfathered models stay
  on agents that already use them.
- **Networking** — VPC configurations start empty, and that's correct on `light`:
  its agents run in `PUBLIC` network mode, and a light deploy only has public
  subnets, so there's nothing a VPC config would point at. These are named
  presets the *UI* uses to deploy an agent into a VPC. On the production tiers the
  chant-deployed agents already carry their VPC config in the template — a Loom
  VPC config is only needed if you also deploy VPC-mode agents from the UI, at
  which point you register one against the deployed private subnets.
- **Infrastructure** — the Agent Registry ARN. loomster doesn't provision a
  registry (see [Registry and Skills](#registry-and-skills)), so it's empty unless
  you set `LOOM_REGISTRY_ID` or enter one here.
- **Models → Refresh** — rewrites Loom's `etc/models.json` inside the backend
  container. The harness checks the route is there but never presses it.

## Runtime screens

**Costs**, **Admin** (audit logs and session analytics), **Chat**, and
**Invocations** are computed from real invocation records — they show nothing
until agents run. Rather than fabricate spend, `demo` lights them up *honestly*:
after the demo agent reaches `READY`, loom-seed invokes it a few times, so the
Costs dashboard shows real (if tiny) usage and the audit/session screens have
activity. On the emulator this is free; on `foundation` it's skipped, because
invoking a real agent on a live account costs money. The harness asserts the
Costs dashboard has at least one recorded invocation on demo — a zero there means
the runtime path never ran. The **approval log** (Security → Approval Policies)
fills the same way, once an agent's tool call hits a policy, so it's checked to
render only.

## How this is enforced

`npm run validate` (or `just validate`) checks all of the above against a running
deploy: every screen must return 200, and every section a profile is meant to
seed must be non-empty. An empty Catalog section, an all-failed agent deploy, or
a missing authorizer fails the run. So "the deploy is usable" is a check, not a
claim. See [Seeded defaults](/loomster/reference/seeding/) for the profiles and
how to run it.
