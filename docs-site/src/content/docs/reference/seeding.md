---
title: Seeded defaults
description: What a fresh Loom deploy seeds, why the Security screen's pickers start empty, and how the loom-seed Op fills them per tier (demo / foundation / none), configurable via LOOM_SEED_PROFILE.
---

A fresh Loom deploy comes up mostly empty. Loom's own database init seeds only
the platform tags and a set of demo tag-profiles — nothing else. So the Security
screen's IAM-role and authorizer pickers are blank, and you can't deploy an agent
until an admin imports a role and an authorizer (Loom's `ONBOARDING.md`, Steps
1–2).

loomster already provisions those resources — the shared-foundation agent
execution role, the Cognito pool — but Loom doesn't know about them until they're
registered in the app. The `loom-seed` Op does that, by driving Loom's own
supported import/create endpoints. It never edits Loom's source.

## Profiles

Selected by tier, overridable with `LOOM_SEED_PROFILE`:

| Profile | Default for | Seeds |
|---|---|---|
| `foundation` | `production`, `production-ha` | The agent execution role (imported) + a Cognito authorizer. Enough to deploy an agent. No cost-incurring content. |
| `demo` | `light` | Foundation, plus demo content (a sample MCP server) so the Catalog and MCP screens aren't empty. |
| `none` | — | Nothing beyond Loom's own database init. |

## Running it

```sh
npm run seed                                  # tier-default profile, against the local-up app
LOOM_SEED_PROFILE=foundation npm run seed     # config only, no demo content
LOOM_API_BASE_URL=https://loom.example.com npm run seed   # a deployed target
```

`LOOM_API_BASE_URL` is the Loom backend URL (default the local-up proxy at
`http://localhost:8080`). Every write is existence-guarded, so re-running is safe
— the Op skips anything already present.

## Validating a deploy

`npm run validate` (or `just validate`) checks a running Loom screen by screen:
it hits each screen's data endpoint and asserts it returns 200 and holds what the
active profile seeds. It exits non-zero if any screen fails, so "validated" means
every screen loads with the right data, not a spot-check.

```sh
npm run validate                                  # demo profile, local-up app
LOOM_SEED_PROFILE=foundation npm run validate     # production floor
LOOM_API_BASE_URL=https://loom.example.com npm run validate
```

Run it against a fresh deploy and the Security screens fail (no role, no
authorizer); run `npm run seed`, then validate again and every screen passes.

## What it does not seed

Memory resources and agents are left to you: creating them provisions real AWS
resources (an AgentCore memory, a runtime), which costs money on a live account.
The `demo` profile stops at a sample MCP server. MCP servers, A2A agents,
memories, and agents are the demo-admin steps (Loom's `ONBOARDING.md`, Steps
3–6), added from the UI when you want them.
