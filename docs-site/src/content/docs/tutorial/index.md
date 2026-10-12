---
title: Browse Loom on your laptop
description: Tutorial step 1. Bring Loom up on Floci, walk the screens the demo seed fills, and check them with the validation harness, with no AWS account.
prompt: |
  Read https://intentius.io/loomster/tutorial/ and follow it in this checkout.
  Bring Loom up with `just local-up`, run `just validate`, and report which screens passed and what each one shows.
  Leave the stack running when you finish, and say how to stop it.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

This tutorial goes from a laptop to production in four steps, cheapest first:

1. Browse Loom on your laptop (this page). No account, no cost.
2. [Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/), the cheapest
   real deployment.
3. [Go to production](/loomster/tutorial/production/): HTTPS, your network,
   PrivateLink, an RDS Proxy.
4. [Run your first Ops](/loomster/tutorial/operate/): back up, check drift, prove a
   restore.

Nothing in the source changes between them. Two settings do: the
[tier](/loomster/concepts/tiers-and-instances/) and whether the target is
[Floci](/loomster/concepts/glossary/#floci) or a real account.

## Result

A Loom with something on every screen, and a validation run that says so.

## Prerequisites

Docker, Node.js 22 or later, and the repository with `npm install` run
([Run Loom locally](/loomster/getting-started/#prerequisites)).

## Steps

### 1. Bring it up

```
just local-up
open http://localhost:8080
```

Sign in as `loom-admin` with the password `local-up` printed last (also in
`dist/local/admin-login.txt`). That is a real Cognito login against the pool on
Floci.

### 2. Walk the screens

A fresh Loom database holds almost nothing. `local-up` ends by running
`loom-seed` on the `demo` profile, which fills the screens through Loom's own
API. Loom's sidebar groups them like this:

| Sidebar | Screen | What the demo seed put there |
|---|---|---|
| Home | Catalog | One entry in each section: Agents, Memory Resources, MCP Servers, A2A Agents |
| Build | Agents | `loomster_demo_agent`, deployed through Loom's own deploy path; open it for the Details, Invoke and Evaluations tabs |
| Build | Memory | One memory with a summary strategy |
| Build | Integrations | The MCP Servers tab has a sample server; the A2A Agents tab has an agent whose card the local proxy serves |
| Build | Skills | Empty locally: skills live in an Agent Registry, which the local stack doesn't have |
| Operate | Security | Identity providers (empty on purpose), IAM roles (the imported agent role), Authorizers (a Cognito authorizer), Approval policies (a notify-only policy) |
| Operate | Analytics | Costs and User activity from a few demo invocations of the agent |
| System | Settings | General, Models, Networking, Infrastructure and Tagging; Tagging has a `loomster` tag profile |

Everything the seed creates is tagged `loom:application=loomster`,
`loom:owner=loomster` and `loom:group=loomster`. Since Loom v1.9.0 a resource
without a `loom:group` tag is visible to super-admins only, so the tag is what
makes the seeded rows visible to a group.

[Screens](/loomster/reference/screens/) explains each screen, and why Identity
providers stays empty: registering one switches Loom's login page to that
provider and locks out a stack that has no real IdP behind it.

### 3. Validate

```
just validate
```

The harness mints a token, reads each screen's endpoint, and fails if a section
the `demo` profile seeds is empty, or if every agent deploy failed. A pass means
every screen loads with the data it should have.

### 4. Know what is local

Agents deploy locally, but invoking one returns a canned reply from Floci, so
the Invoke tab and the costs it produces aren't real reasoning. Evaluations
aren't emulated, IAM isn't enforced unless you opt in, and no telemetry is
shipped. The full list is in
[Local caveats](/loomster/reference/local-caveats/).

`just local-down` stops everything.

## Next

[Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/).
