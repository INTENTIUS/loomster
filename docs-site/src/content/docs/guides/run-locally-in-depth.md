---
title: Work with the local stack
description: What runs in the local Floci stack and what is a stand-in, how to call Loom's API from a shell, how the local login reaches Floci's Cognito through a small Loom patch, and how the stack is wired.
prompt: |
  Read https://intentius.io/loomster/guides/run-locally-in-depth/ and, with the local stack running, mint an API token with `scripts/local/local-token.sh` and call `/api/auth/me`.
  Report the user and groups it returns, and which layers of the stack are real per the page's table.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

An API token for the local Loom, and a clear picture of what the local stack
proves and what it doesn't.

## Prerequisites

The local stack running ([Run Loom locally](/loomster/getting-started/)).

## Steps

### Call the API from a shell

Mint a token the way the real tiers' validation does:

```
export LOOM_API_TOKEN=$(bash scripts/local/local-token.sh)
curl -H "Authorization: Bearer $LOOM_API_TOKEN" http://localhost:8080/api/auth/me
npm run validate    # mints its own token when LOOM_API_TOKEN is unset
```

The app listens on `127.0.0.1:8080`, so it's reachable from this machine only.

### Know what is real

| Layer | Local |
|---|---|
| PostgreSQL | Real Postgres 15; the backend runs its real schema migrations |
| Backend API | Real: every database-backed router |
| Frontend | Real, served through the proxy at one origin |
| S3, ECR, KMS, ECS | Provisioned by [chant](/loomster/concepts/glossary/#chant) on [Floci](/loomster/concepts/glossary/#floci) |
| Login | Real Cognito flow against Floci's pool: the login form, RS256 tokens, Loom's token validation and group-derived scopes, through loomster's Loom patch |
| ALB | A proxy: path routing only (`/api/*` and `/health` to the backend, `/floci-cognito/` to Floci for the login, the rest to the frontend); no TLS or WAF |
| Agents, deploy | Real control plane on Floci: runtimes, endpoints, gateways, memory, workload identity |
| Agents, invoke | Canned reply, `{"output":"yes"}` unless `FLOCI_SERVICES_BEDROCK_AGENT_CORE_INVOKE_RESPONSE` sets another |
| IAM | Not enforced by default; an opt-in check of loom-backend's task role ([below](#check-the-backends-iam-role-locally)) |
| KMS | Real AES-256-GCM encryption in Floci |
| AgentCore Evaluations | Not emulated: the evaluator list and runs return `502` |
| CloudWatch, OTel, security groups | Not exercised ([Local caveats](/loomster/reference/local-caveats/)) |

### Check the backend's IAM role locally

By default the backend runs on Floci's `test` key, which Floci never checks, so
IAM isn't enforced. To check loom-backend's task role against what Loom calls,
opt in:

```
LOOM_LOCAL_IAM_ENFORCEMENT=true just local-up
```

local-up then starts Floci with `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true`
and runs the backend as loom-backend's task role, the role its ECS task has on
AWS. The role trusts only `ecs-tasks.amazonaws.com`, so after provisioning
local-up adds this account to its trust policy, on Floci only, assumes the role
for 12 hours, and writes that session into the backend's `.env`. chant,
local-up and the seed keep the `test` key. Step 4 prints which identity the
backend got. Switching modes needs a fresh Floci (`just local-down` first);
local-up stops if the running one was started in the other mode.

Read the denials in the backend log with care:

```
docker logs loom-local-loomBackend-1 2>&1 | grep -iE "AccessDenied|not authorized"
```

- An action the role doesn't grant at all is a real gap: it fails on AWS too.
- A denial for Cognito (`cognito-idp:*`), CloudWatch Logs (`logs:*`) or IAM
  (`iam:*`) is usually Floci, not the role. Floci 2.2.0 builds request ARNs
  only for S3, Lambda, SQS, SNS, DynamoDB, Kinesis, Secrets Manager, SSM and
  KMS, and checks every other service's actions against `Resource: "*"`, so a
  grant scoped to ARNs (user pools in this account, agent log groups, project
  roles) never matches there. AWS allows those calls. On a fresh enforced
  local-up that includes `DescribeUserPool` (the seed's authorizer step fails
  on it), `FilterLogEvents`, `StartQuery`, `CreateLogGroup`, `ListRoleTags` and
  `ListRolePolicies`. Check the action against the task role in
  `src/composites/loom-backend.ts` before changing anything.

That noise is why enforcement is opt-in.

### Point chant at Floci

`chant.config.ts` declares the endpoint of the two Floci environments, `local`
(this stack) and `floci` (the production-tier Floci E2E), so a live read targets
Floci without exporting `AWS_ENDPOINT_URL`:

```
LOOM_ENV=local AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  npx chant lifecycle diff local aws --live
```

chant prints that it applied the declared endpoint, then the stacks it found on
Floci. It injects only the endpoint; the shell still needs Floci's `test` keys,
since Floci doesn't know real AWS keys and rejects them when IAM enforcement is
on.

local-up starts Floci itself rather than through `chant emulator up` or the
`flociUp` [Op](/loomster/concepts/glossary/#op) step, which pin `floci/floci:1.5.34` under a fixed container name
and can't pass the Docker network, the `FLOCI_*` settings or the loopback-only
port binding local-up needs.

### Login through Floci

The light [tier](/loomster/concepts/tiers-and-instances/)'s `loom-cognito` stack
creates a pool on Floci as it does on AWS. Floci 2.2.0 issues RS256 tokens with
`cognito:groups` and serves the pool's JWKS and discovery under
`/<pool-id>/.well-known/`. `local-up` then:

- adds what light leaves out and a local login needs, on Floci only: a public
  user client `loom-local-user`, the `t-admin` and `g-admins-super` groups, and
  the `loom-admin` user;
- sets the backend's `LOOM_COGNITO_USER_POOL_ID` to the Floci pool and
  `LOOM_COGNITO_ENDPOINT_URL=http://floci:4566`. Floci runs with
  `FLOCI_HOSTNAME=floci`, so its tokens' issuer is the address the backend
  reaches it at;
- builds the frontend with the user client id and
  `VITE_COGNITO_ENDPOINT_URL=/floci-cognito/`; the proxy forwards that path to
  Floci and lets only `InitiateAuth` and `RespondToAuthChallenge` through;
- leaves `LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV` unset, so a request without a
  valid token gets 401, as on AWS.

### The Loom patch

Loom v1.9.0 builds the issuer and JWKS URL from
`https://cognito-idp.<region>.amazonaws.com/<pool-id>`, and its login form posts
to the same AWS host. Its external OIDC path takes any issuer, but fetches the
JWKS through an SSRF guard that refuses Floci's private address, and checks an
`aud` claim Cognito access tokens don't carry.

So `scripts/vendor-loom.sh` applies
`scripts/loom-patches/0001-cognito-endpoint-override.patch`, which adds two
opt-in settings:

- backend `LOOM_COGNITO_ENDPOINT_URL` replaces the AWS host as issuer and JWKS
  base, and fetches that operator-set JWKS directly instead of through the SSRF
  guard;
- frontend build argument `VITE_COGNITO_ENDPOINT_URL` is where the login form
  posts.

With both unset, as on every real tier, the patched code takes upstream's path.
The vendor script checks each patch before applying it and fails naming the
patch if a Loom bump moved the code. The second patch,
`0002-ssrf-guard-prefer-ipv4.patch`, makes Loom's SSRF guard prefer an IPv4
address, so a backend on an IPv4-only VPC doesn't pick Cognito's IPv6 address
and reject every login.

### Wiring

Nothing is hand-written config. The compose file comes from a docker-lexicon
graph (`chant build src/local --lexicon docker`), the proxy's routes from Loom's
real ALB rules, and Floci is provisioned by chant. `scripts/local/local-up.sh`
resolves the runtime values and calls `chant` and `docker compose`. The proxy is
an ordinary container on the shared network: it reaches the backend as
`loomBackend:8000` and serves the demo A2A card at
`http://loomProxy:8080/a2a-demo`, a private address Loom's A2A SSRF guard
allows.

## Next

[Local caveats](/loomster/reference/local-caveats/) before you trust anything the
local stack shows.
