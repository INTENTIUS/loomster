---
title: Run Loom on your laptop
description: The light tier runs a browsable Loom locally against Floci, signed in as a dev user with no login. What works, what's a dev shortcut, and what can't run without real AWS.
---

`just local-up` stands up a **browsable Loom on a laptop**, with no AWS account
and no login: authentication is Loom's local-dev bypass, so every request runs
as an admin `local-dev` user. [Floci](https://floci.io), a local AWS emulator, provides the
managed pieces (RDS, Cognito, S3, ECR); the app tier (frontend, backend, and a
reverse proxy standing in for the ALB) runs from a chant-generated
`docker-compose.yml`, wired to Floci. You get the full web app. Real Postgres,
real API, logged in as an admin `local-dev` user. Agents now **deploy** locally
too — the Floci image emulates Bedrock AgentCore's control plane — though
invoking one returns a canned stub, not real agent reasoning (see below).

## Prerequisites

- **Docker**, the only requirement. No AWS account, no cloud calls.
- This repo, `npm install`.

## Bring it up

```
just local-up
```

That runs, in order: Floci up, vendor Loom `v1.9.0`, synth and provision the
infrastructure on Floci, build the app images, resolve the Floci values into a
`.env`, generate the compose and nginx config, and `docker compose up`. When it
finishes:

```
open http://localhost:8080
```

You land in the Loom UI as `local-dev` (admin, all scopes), with no login step.
Browse the catalog, settings, memories, credentials, costs; everything the API
serves from Postgres is live. The port is bound to `127.0.0.1`, so the app is
reachable from this machine only, not from your network.

```
just local-down    # tear down the app stack and Floci
```

## What actually runs

| Layer | Local status |
|---|---|
| PostgreSQL (data tier) | Real — a genuine Postgres 15; the backend runs its real schema migrations against it |
| Backend API (FastAPI) | Real — all DB/config routers: catalog, settings, costs, memories, security, registry, mcp, identity, credentials, approvals, logs, traces |
| Frontend (SPA) | Real — served through the proxy at one origin |
| S3 / ECR / KMS / ECS | Real — bucket, image registry, cluster all provisioned by chant on Floci |
| Auth / login | Dev shortcut — Loom's built-in bypass (see below), not a real login |
| The "ALB" | Proxy stand-in — path routing only (`/api/*` and `/health` to the backend over loopback, everything else to the frontend); no TLS or WAF |
| Agents (deploy) | Real — the Floci image emulates AgentCore's control plane (runtimes, endpoints, gateways, memory, workload identity) |
| Agents (invoke) | Stub — `invoke-agent-runtime` returns a canned response, not real agent reasoning |
| IAM enforcement, KMS crypto, CloudWatch/OTel | Not real — see [Local caveats](/loomster/reference/local-caveats/) |

## Auth is a dev bypass

The local tier doesn't authenticate anyone. It leaves `LOOM_COGNITO_USER_POOL_ID`
unset, which engages **Loom's own dev bypass** (`backend/app/dependencies/auth.py`):
with no Cognito pool and no external IdP, every request is a `local-dev` user
with the admin groups and all scopes. Production uses the real Cognito pool and
real JWT validation.

Why not log in against Floci's Cognito? Floci 2.2.0 issues RS256 JWTs (with
`cognito:groups`), serves discovery and JWKS under `/<pool-id>/.well-known/`,
runs a managed login page, and with `FLOCI_TLS_ENABLED=true` advertises all of
it over `https`. Loom v1.9.0 still can't use it:

- Loom's Cognito validator builds the issuer and JWKS URL as
  `https://cognito-idp.<region>.amazonaws.com/<pool-id>`, with no endpoint
  override, and the SPA's login posts to the same AWS host.
- Loom's external OIDC path takes any issuer, but from v1.7.0 it fetches the
  JWKS through an SSRF guard that refuses private addresses, and Floci sits on
  a private Docker network address. Getting past that means putting Floci on a
  subnet the guard doesn't classify as private, which defeats the guard.
- That path also checks the access token's `aud` against the client id.
  Cognito access tokens carry `client_id` and no `aud`, on AWS and on Floci, so
  it would also need a pre token generation trigger that adds `aud`.

Newer Loom versions tighten the bypass, and the local tier is wired for them:

- v1.6.1+ only bypasses with `LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV=true`, which
  the local compose sets. Older versions ignore it.
- v1.8.1+ also requires the request to come from a loopback address and to
  carry no `X-Forwarded-*`, `X-Real-IP` or `Forwarded` header. The proxy
  therefore runs inside the backend container's network namespace, reaches the
  backend at `127.0.0.1:8000`, and clears those headers. The browser, `npm run
  seed` and `npm run validate` all go through it at `http://localhost:8080`.

This has two consequences. The published port is bound to the host's `127.0.0.1`, since
anyone who can reach it is an admin. And if you reach the backend any other way
(a different proxy, a port published on another interface) on Loom v1.8.1+,
every API call returns `401 No identity provider configured` and the UI loads
with empty, failing screens. Upstream plans to remove the bypass entirely
([awslabs/loom#79](https://github.com/awslabs/loom/issues/79)); when that lands,
the local tier needs a Loom-side way to trust a local issuer.

## Agents deploy locally; invoke is a stub

Floci (`floci/floci:2.2.0`; upstream Floci now includes what the loomster#98 fork
added) emulates Bedrock AgentCore's **control plane** with full state — the resources
chant synthesizes (Runtime, RuntimeEndpoint, Memory, Gateway, WorkloadIdentity)
actually deploy and are queryable, so the `loom-agents` wave reaches a real
`CREATE_COMPLETE` on Floci — the resources exist and respond, they aren't
CloudFormation bookkeeping.

What's still a stand-in is the **data plane**: `invoke-agent-runtime` returns a
canned response (`{"output":"yes"}` by default, tunable via
`FLOCI_SERVICES_BEDROCK_AGENT_CORE_INVOKE_RESPONSE`), not a real agent run. The
app stays fully usable — the agents catalog lists and manages definitions from
Postgres, and deploys resolve — but an invoked agent replies with the stub rather
than genuine reasoning. For real agent execution, deploy the `production` /
`production-ha` tier against real AWS.

## How it's wired

Nothing here is hand-authored config. The compose file is generated by chant from
a docker-lexicon graph (`chant build src/local --lexicon docker`), the nginx
routing is generated from Loom's real ALB rules, and Floci is provisioned by
chant. The harness (`scripts/local/local-up.sh`) is thin glue that resolves the
runtime values and calls `chant` and `docker compose`.

Before you rely on anything you see locally, read
[Local caveats](/loomster/reference/local-caveats/). The local run diverges from
real AWS in specific, load-bearing ways.
