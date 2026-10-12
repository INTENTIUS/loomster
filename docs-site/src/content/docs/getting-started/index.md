---
title: Run Loom locally
description: Bring up a browsable Loom on your laptop with one command, log in through a real Cognito flow on Floci, and check every screen, with Docker and no AWS account.
prompt: |
  Read https://intentius.io/loomster/getting-started/ and follow it in this checkout.
  Run `npm install`, then `just local-up`, and report the URL and the login it prints.
  Then run `just validate` and report each screen's verdict.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

Loom v1.9.0 running at `http://localhost:8080`, logged in as an admin, with every
screen showing seeded data. The managed AWS pieces run on
[Floci](/loomster/concepts/glossary/#floci), a local AWS emulator; the app runs
from a compose file [chant](/loomster/concepts/glossary/#chant) generates.

## Prerequisites

- Docker. Nothing else runs outside containers, and no AWS account is used.
- Node.js 22 or later, and this repository:

```
git clone https://github.com/INTENTIUS/loomster
cd loomster
npm install
```

## Steps

1. Bring it up:

   ```
   just local-up
   ```

   This starts Floci, fetches Loom v1.9.0 into `vendor/loom`, deploys the light
   [tier](/loomster/concepts/tiers-and-instances/) on Floci, builds Loom's images,
   starts the frontend, backend and a proxy, and seeds demo content. The last
   lines it prints include the login:

   ```
     login: loom-admin / Loom-3f9a1c0b7e2d-4E1Ax7   (Cognito on Floci; throwaway, new each local-up; also in dist/local/admin-login.txt)
   ```

2. Open `http://localhost:8080` and sign in as `loom-admin` with that password.
   The user is in Loom's `t-admin` and `g-admins-super` groups, so it sees every
   screen. The password changes on every `local-up`.

3. Check the screens:

   ```
   just validate
   ```

   It reads each screen's API endpoint and fails if a screen the demo profile
   seeds comes up empty.

4. Tear it down when you're done:

   ```
   just local-down
   ```

   Run it before another `just local-up` too: provisioning again on a running
   Floci fails when chant pushes an image tag the ECR repository already holds.

Agents deploy locally, because Floci emulates the AgentCore control plane, but
invoking one returns a canned reply. Real agent runs need AWS. Everything else
the web app does is real: Postgres, the API, the login and the group-derived
scopes. [Local caveats](/loomster/reference/local-caveats/) lists where the local
run differs from AWS.

## Next

- [Browse Loom on your laptop](/loomster/tutorial/), the first tutorial step, walks
  the seeded screens.
- [Work with the local stack](/loomster/guides/run-locally-in-depth/) covers API
  tokens, the Loom patch the local login needs, and how the stack is wired.
- [Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/) when you want it
  on a real account.
