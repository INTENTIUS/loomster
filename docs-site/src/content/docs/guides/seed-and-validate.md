---
title: Seed and validate a deploy
description: Register what loomster provisioned into a fresh Loom through its API with the loom-seed Op, choose a seed profile, and check every screen with the validation harness.
prompt: |
  Read https://intentius.io/loomster/guides/seed-and-validate/ and seed the Loom deployment the person names with the profile they choose (foundation unless they asked for demo), then run the validation and report each screen's verdict.
  Use a token from the page's steps; delete any throwaway user and client you created.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

The shared agent role and a Cognito authorizer registered in Loom, so an agent
can be deployed, plus demo content on the `demo` profile, and a validation run
that passes.

## Prerequisites

- A running Loom: `just local-up`, or a deployed tier.
- The deployment's `LOOM_*` variables and AWS credentials. The seed looks up the
  agent role and the Cognito pool from the stacks.
- For a deployed tier, a token:
  `export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)` mints one
  on any tier. Against the local stack both commands mint their own.

## Steps

1. Pick the profile. The [tier](/loomster/concepts/tiers-and-instances/) sets the
   default (`demo` on light, `foundation` on the production tiers);
   `LOOM_SEED_PROFILE` overrides it. [Screens](/loomster/reference/screens/#seed-profiles)
   lists what each writes. On a live account `demo` creates billable resources.

2. Seed:

   ```
   export LOOM_API_BASE_URL=https://loom.example.com   # default http://localhost:8080
   LOOM_SEED_PROFILE=foundation npm run seed
   ```

   Each step prints one line, `loom-seed: step=<name> verdict=ok|present|skipped|failed`.
   Every write checks for the record first, so a re-run skips what exists. Only
   optional steps skip, with the reason: no Cognito pool for the authorizer, no
   `LOOM_DEMO_A2A_URL` for the A2A agent, no registry for the skill. Any failed
   step, including the demo agent not reaching `READY`, makes the seed exit
   non-zero after the rest have run.

3. Validate with the same profile:

   ```
   LOOM_SEED_PROFILE=foundation npm run validate
   ```

   It reads each screen's endpoint and fails if a section the profile seeds is
   empty. Before seeding, the Security checks fail; after, they pass.

Optional settings: `LOOM_SEED_GROUP` sets the `loom:group` on seeded rows
(default `loomster`; use your team's group on a multi-tenant deploy),
`LOOM_SEED_MODEL_ID` fixes the demo agent's model, `LOOM_DEMO_A2A_URL` points the
A2A agent at a reachable card, and `LOOM_REGISTRY_ID` enables the skill step.

The seed only writes through Loom's own endpoints, never to the database
directly, and never registers an identity provider.

## Next

- [Screens](/loomster/reference/screens/) for what each screen should now show.
- [Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)
  for agents beyond the demo.
