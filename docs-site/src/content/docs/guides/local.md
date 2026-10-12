---
title: Run Loom on your laptop
description: The light tier runs a browsable Loom locally against Floci, with a real Cognito login against Floci's emulated pool. What works, what's patched, and what can't run without real AWS.
---

`just local-up` stands up a **browsable Loom on a laptop**, with no AWS account.
You log in through the Loom frontend against a real Cognito user pool that
[Floci](https://floci.io), a local AWS emulator, runs. Floci provides the
managed pieces (RDS, Cognito, S3, ECR); the app tier (frontend, backend, and a
reverse proxy standing in for the ALB) runs from a chant-generated
`docker-compose.yml`, wired to Floci. You get the full web app: real Postgres,
real API, real login. Agents **deploy** locally too, since Floci emulates
Bedrock AgentCore's control plane, but invoking one returns a canned stub, not
real agent reasoning (see below).

## Prerequisites

- **Docker**, the only requirement. No AWS account, no cloud calls.
- This repo, `npm install`.

## Bring it up

```
just local-up
```

That runs, in order: Floci up, vendor Loom `v1.9.0` (with loomster's Loom
patch, see below), synth and provision the infrastructure on Floci, set up the
Cognito login and resolve the Floci values into a `.env`, build the app images,
generate the compose and nginx config, `docker compose up`, and seed the demo
data. The last lines it prints include the login:

```
  login: loom-admin / Loom-3f9a1c0b7e2d-4E1Ax7   (Cognito on Floci; throwaway, new each local-up; also in dist/local/admin-login.txt)
```

```
open http://localhost:8080
```

Sign in as `loom-admin` with that password. The user is in Loom's `t-admin` and
`g-admins-super` groups, so it sees the admin dashboard with every scope.
The password is random and reset on every `local-up`; `dist/local/admin-login.txt`
(gitignored, mode 600) keeps the current one. Browse the catalog, settings,
memories, credentials, costs; everything the API serves from Postgres is live.
The port is bound to `127.0.0.1`, so the app is reachable from this machine
only, not from your network.

For the API from a shell, mint a token the way the real tiers' validation does:

```
export LOOM_API_TOKEN=$(bash scripts/local/local-token.sh)
curl -H "Authorization: Bearer $LOOM_API_TOKEN" http://localhost:8080/api/auth/me
npm run validate    # mints its own token against the local app when LOOM_API_TOKEN is unset
```

```
just local-down    # tear down the app stack and Floci
```

Run `just local-down` before another `just local-up`: provisioning again on a
running Floci fails when chant pushes an image tag the ECR repository already
holds (its tags are immutable).

## Check the backend's IAM role locally

By default the backend runs on Floci's `test` key, which Floci never checks,
so IAM isn't enforced. To check loom-backend's task role against what Loom
calls, opt in:

```
LOOM_LOCAL_IAM_ENFORCEMENT=true just local-up
```

local-up then starts Floci with `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true`
and runs the backend as **loom-backend's task role**, the role its ECS task has
on AWS. The role trusts only `ecs-tasks.amazonaws.com`, so after provisioning
local-up adds this account to its trust policy, on Floci only, assumes the
role for 12 hours, and writes that session into the backend's `.env`. chant,
local-up and seed keep the `test` key. Step 4 prints which identity the
backend got. Switching modes needs a fresh Floci (`just local-down` first);
local-up stops if the running one was started in the other mode.

Read the denials in the backend log with care:

```
docker logs loom-local-loomBackend-1 2>&1 | grep -iE "AccessDenied|not authorized"
```

- **An action the role doesn't grant at all** is a real gap: it fails on AWS
  too. This is how loomster#1 (AgentCore actions missing from the task role)
  would have shown up.
- **A denial for Cognito (`cognito-idp:*`), CloudWatch Logs (`logs:*`) or IAM
  (`iam:*`)** is usually Floci, not the role. Floci 2.2.0 builds request ARNs
  only for S3, Lambda, SQS, SNS, DynamoDB, Kinesis, Secrets Manager, SSM and
  KMS, and checks every other service's actions against `Resource: "*"`, so a
  grant scoped to ARNs (user pools in this account, agent log groups, project
  roles) never matches there. AWS allows those calls. On a fresh enforced
  local-up that includes `DescribeUserPool` (the seed's authorizer step fails
  on it), `FilterLogEvents`, `StartQuery`, `CreateLogGroup`, `ListRoleTags` and
  `ListRolePolicies`. Check the action against the task role in
  `src/composites/loom-backend.ts` before changing anything.

That noise is why enforcement is opt-in rather than the default.

## Point chant at Floci

`chant.config.ts` declares the endpoint of the two Floci environments, `local`
(this guide) and `floci` (the production-tier Floci E2E), so a live read
targets Floci without exporting `AWS_ENDPOINT_URL`:

```
LOOM_ENV=local AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  npx chant lifecycle diff local aws --live
```

chant prints that it applied the declared endpoint, then the stacks it
observed on Floci. It injects only the endpoint. The shell still needs Floci's `test` keys:
real AWS keys are unknown to Floci, and it rejects them when IAM enforcement is
on.

local-up starts Floci itself rather than through `chant emulator up` or the
`flociUp` Op step. Those pin `floci/floci:1.5.34` under a fixed container
name and can't pass the Docker network, the `FLOCI_*` settings or the
loopback-only port binding local-up needs.

## What actually runs

| Layer | Local status |
|---|---|
| PostgreSQL (data tier) | Real — a genuine Postgres 15; the backend runs its real schema migrations against it |
| Backend API (FastAPI) | Real — all DB/config routers: catalog, settings, costs, memories, security, registry, mcp, identity, credentials, approvals, logs, traces |
| Frontend (SPA) | Real — served through the proxy at one origin |
| S3 / ECR / KMS / ECS | Real — bucket, image registry, cluster all provisioned by chant on Floci |
| Auth / login | Real Cognito flow against Floci's pool: the SPA's login form, RS256 JWTs, Loom's own token validation and group-derived scopes. Needs loomster's Loom patch (see below) |
| The "ALB" | Proxy stand-in — path routing only (`/api/*` and `/health` to the backend, everything else to the frontend, plus `/floci-cognito/` for the login); no TLS or WAF |
| Agents (deploy) | Real — the Floci image emulates AgentCore's control plane (runtimes, endpoints, gateways, memory, workload identity) |
| Agents (invoke) | Stub — `invoke-agent-runtime` returns a canned response, not real agent reasoning |
| IAM | Not enforced by default; opt-in check of loom-backend's task role (see above) |
| KMS | Real AES-256-GCM encryption in Floci |
| AgentCore Evaluations | Not emulated — the evaluator list and runs return `502` |
| CloudWatch/OTel, security groups | Not exercised — see [Local caveats](/loomster/reference/local-caveats/) |

## Login runs against Floci's Cognito

The light tier's `loom-cognito` stack provisions a user pool on Floci like it
does on AWS. Floci 2.2.0 issues RS256 access and id tokens with
`cognito:groups` and serves the pool's JWKS and discovery under
`/<pool-id>/.well-known/`. local-up wires Loom to it:

- It adds what the light tier leaves out and local login needs, on Floci only:
  a public user client `loom-local-user` (password and refresh flows), the
  `t-admin` and `g-admins-super` groups, and the `loom-admin` user.
- The backend gets `LOOM_COGNITO_USER_POOL_ID` (the Floci pool) and
  `LOOM_COGNITO_ENDPOINT_URL=http://floci:4566`. Floci runs with
  `FLOCI_HOSTNAME=floci`, so its tokens' issuer is
  `http://floci:4566/<pool-id>`, the address the backend reaches Floci at.
- The frontend is built with the user client id and
  `VITE_COGNITO_ENDPOINT_URL=/floci-cognito/`. The proxy forwards that path to
  Floci's Cognito API and lets only the `InitiateAuth` and
  `RespondToAuthChallenge` calls through.
- `LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV` is not set. A request without a valid
  token gets `401`, as on a real deployment.
- Seed and validate authenticate with a token minted by
  `scripts/local/local-token.sh`, which runs
  `scripts/validate/get-user-token.sh` (the real tiers' throwaway-admin flow)
  against Floci.

### The Loom patch

Loom v1.9.0 can't do this on its own. Its Cognito validator builds the issuer
and JWKS URL from `https://cognito-idp.<region>.amazonaws.com/<pool-id>`, and
the SPA's login form posts to the same AWS host. Loom's external OIDC path takes
any issuer, but it fetches the JWKS through an SSRF guard that refuses Floci's
private address, and it checks an `aud` claim that Cognito access tokens don't
have.

So `scripts/vendor-loom.sh` applies
`scripts/loom-patches/0001-cognito-endpoint-override.patch` to the vendored
source. It adds two opt-in settings:

- backend `LOOM_COGNITO_ENDPOINT_URL`: replaces the AWS host as the issuer and
  JWKS base. The JWKS for this operator-set URL is fetched directly rather than
  through the SSRF guard. Tokens are otherwise validated the way Loom validates
  real Cognito tokens.
- frontend build arg `VITE_COGNITO_ENDPOINT_URL`: where the login form posts.

With both unset, which is how every real tier runs, the patched code takes
upstream's path. The patch stays in loomster and isn't sent upstream. The
vendor script checks it before applying anything and fails with a message
naming the patch if it no longer applies, so a Loom bump that moves the patched
code stops there instead of producing a local stack that silently can't log in.

### Why the proxy has its own container again

Up to loomster#58 the local tier used Loom's local-dev bypass, which (v1.8.1+)
only answers loopback clients, so nginx ran inside the backend container's
network namespace. With real login nothing needs a loopback peer: the proxy is
an ordinary container on the shared network, reaches the backend as
`loomBackend:8000`, and publishes `127.0.0.1:8080`. The demo A2A card is served
at `http://loomProxy:8080/a2a-demo`, a private Docker address that Loom's A2A
SSRF guard allows.

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
