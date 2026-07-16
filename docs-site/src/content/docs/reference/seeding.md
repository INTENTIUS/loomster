---
title: Seeded defaults
description: What a fresh Loom deploy seeds, why the Security screen's pickers start empty, and how the loom-seed Op fills them per tier (demo / foundation / none), configurable via LOOM_SEED_PROFILE.
---

> For the screen-by-screen view of what this populates and why, see the
> [Screens reference](/loomster/reference/screens/). This page is the mechanics:
> profiles, how to run it, and what it does not seed.

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
| `demo` | `light` | Foundation, plus demo content in every Catalog section — a sample MCP server, a memory, a deployed agent, and (given a reachable endpoint) an A2A agent — so the Catalog isn't empty. |
| `none` | — | Nothing beyond Loom's own database init. |

## Everything is branded `loomster`

Every record `loom-seed` creates carries the `loomster` brand, so it's
identifiable apart from Loom's own demo data and anything entered by hand:

- a `loomster` tag profile on the Tagging screen,
- the `loom:application` and `loom:owner` tags set to `loomster` on seeded resources,
- `Loomster`-prefixed names ("Loomster Cognito Pool", "Loomster Echo MCP").

`loom:group` governs who can see a resource, so it stays overridable via
`LOOM_SEED_GROUP` (default `loomster`) — set it to your team's group on a
multi-tenant deploy.

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

## The Security screen

`foundation` seeds the two tabs an agent deploy needs — an imported IAM role and
a Cognito authorizer. `demo` additionally seeds an approval policy and a pending
permission request, so those tabs aren't empty either.

One tab is deliberately left empty: **Identity Providers**. Registering one flips
Loom out of its dev-auth bypass into real-OIDC mode, which locks a local or demo
deploy (there's no real IdP to authenticate against). You add a real provider
there on a real deploy; seeding a fake one would only break the app.

## Demo content and cost

The `demo` profile deploys a real agent and creates a memory — free on the
Floci emulator, but real (billable) resources on a live account. That's why it's
the default only on `light`; the production tiers default to `foundation`, which
seeds none of it. The A2A agent needs a reachable endpoint that serves an agent
card: `just local-up` serves one from its proxy and sets `LOOM_DEMO_A2A_URL`
automatically; elsewhere, set `LOOM_DEMO_A2A_URL` to a real A2A agent or the A2A
section is left for you to fill from the UI (Loom's `ONBOARDING.md`, Step 4).
