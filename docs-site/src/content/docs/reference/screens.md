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
| Security → Permission Requests | `permission_requests` | — | one pending request | on foundation |
| Security → Identity Providers | `identity_providers` | — | — | **always** (see below) |
| Agents | `agents` | — | a deployed agent | on foundation |
| Memory | `memories` | — | a memory | on foundation |
| MCP Servers | `mcp_servers` | — | a sample server | on foundation |
| A2A Agents | `a2a_agents` | — | a registered agent | when no A2A endpoint |
| Catalog | the five above | — | populated | on foundation |
| Settings | app config | Loom defaults | Loom defaults | Networking / Infrastructure |
| Costs, Admin, Chat, Invocations | runtime | — | — | until there's traffic |
| Registry | preview | — | — | until you opt in |

## Tagging

Loom's own init seeds the three locked platform tags (`loom:application`,
`loom:group`, `loom:owner`) and a set of `demo-user-N` tag profiles. `loom-seed`
adds a **`loomster`** tag profile, and stamps every resource it creates with
`loom:application` and `loom:owner` set to `loomster` — so its records are
distinguishable from Loom's demo data and anything entered by hand.

## Security

Five tabs. Two are the floor an agent deploy needs; two are demo content; one is
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
- **Permission Requests** — `demo` seeds one pending request against the seeded
  role, so the review workflow is visible.
- **Identity Providers** — **never seeded.** Registering an identity provider
  flips Loom out of its dev-auth bypass into real-OIDC mode: with no real IdP to
  authenticate against, every request then fails with *"Missing authorization
  token"* and the app locks itself out. You add a real provider here on a real
  deploy; a seeded one would only break a local or demo run. The harness checks
  this tab renders, and asserts nothing is in it.

## Catalog and its sections

The Catalog aggregates four resource types. On `demo`, loom-seed populates every
one so the Catalog isn't a wall of empty sections:

- **Agents** — deploys one agent (`loomster_demo_agent`) via Loom's own deploy
  path (build artifact → S3 → AgentCore runtime). Names must be identifier-style
  (`[A-Za-z][A-Za-z0-9_]*`), and the model is discovered from the catalog rather
  than hardcoded. The harness requires at least one agent that's `READY` or
  `CREATING` — an all-`FAILED` list means the deploy path is broken and fails
  validation.
- **Memory** — creates one memory resource. Creating a memory calls Bedrock
  AgentCore; it's free on the Floci emulator but a real (billable) resource on a
  live account, which is why it's `demo`-only.
- **MCP Servers** — registers one sample server. The create call doesn't validate
  the endpoint, so a placeholder URL is fine.
- **A2A Agents** — registers one agent. Unlike MCP, registration *fetches* the
  agent card from the endpoint, so it needs a reachable one. `just local-up`
  serves a static card from its proxy and sets `LOOM_DEMO_A2A_URL`; without a
  reachable endpoint the A2A section is left for you to fill.

On `foundation`, none of the Catalog is seeded — deploying an agent or creating a
memory costs money on a live account, so the production tiers stay lean and leave
that to you.

## Settings

Settings is **configuration, not content** — and its empty states are correct
defaults, not gaps. Nothing here needs seeding.

- **General** — Loom serves working defaults (e.g. `cpu_io_wait_discount`) without
  needing seeded rows.
- **Models** — the enabled-models list starts empty, and that's intentional: it's
  an allow-list to *restrict* the catalog, so empty means "all models allowed."
  The agent picker uses the full catalog regardless. Seeding a curated list would
  override Loom's own default, not fix anything.
- **Networking** — VPC configurations start empty, which is correct on `light`:
  its agents run in `PUBLIC` network mode and need no VPC config. This is a
  production-tier concern.
- **Infrastructure** — the AgentCore Agent Registry is a preview feature, off by
  default. You opt in on a real deploy; there's nothing to fabricate.

## Runtime screens

**Costs**, **Admin** (audit logs and session analytics), **Chat**, and
**Invocations** are populated by *using* the app, not by seeding — they fill in
as agents are invoked and users act. The harness only checks that they render.
**Registry** is a preview surface that stays empty until you opt in.

## How this is enforced

`npm run validate` (or `just validate`) checks all of the above against a running
deploy: every screen must return 200, and every section a profile is meant to
seed must be non-empty. An empty Catalog section, an all-failed agent deploy, or
a missing authorizer fails the run. So "the deploy is usable" is a check, not a
claim. See [Seeded defaults](/loomster/reference/seeding/) for the profiles and
how to run it.
