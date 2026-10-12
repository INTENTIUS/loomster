---
title: Local caveats
description: How the local (Floci) run diverges from real AWS. Read this before you trust anything the local tier shows you.
---

The local tier ([Run Loom on your laptop](/loomster/guides/local/)) is for
development and to prove the stack deploys and the web tier runs. It is **not** a
fidelity statement about real AWS, and several divergences are load-bearing. Each
below says what's different, why, and what's true on real AWS instead.

## Secrets are plain environment variables

Floci's ECS does not inject Secrets Manager `Secrets` into containers, so the
light tier delivers the database URL as a plain `Environment` variable built from
loom-db's resolved endpoint. **Real AWS** uses Secrets Manager. Don't copy local
secret handling into a real deployment. `production` / `production-ha` keep the
secret.

## `Fn::Sub` GetAtt isn't resolved inside a SecretString

Related: Floci doesn't resolve `Fn::Sub ${LogicalId.Attribute}` GetAtt references
inside a `SecretString`, leaving the literal instead. That's why the light tier
delivers the DB URL via a cross-stack input rather than the secret. The secret
template is correct for real AWS.

## Login is real Cognito, on Floci, through a Loom patch

Locally you log in as `loom-admin` against Floci's Cognito, and Loom validates
the tokens and derives scopes from `cognito:groups`. Two things differ from AWS:

- Loom runs with loomster's patch
  (`scripts/loom-patches/0001-cognito-endpoint-override.patch`), configured
  with `LOOM_COGNITO_ENDPOINT_URL` and `VITE_COGNITO_ENDPOINT_URL`. Upstream
  Loom only talks to `cognito-idp.<region>.amazonaws.com`. Every real tier
  leaves both settings unset. See the
  [local guide](/loomster/guides/local/#the-loom-patch).
- The user client, the two admin groups and the admin user are created by
  local-up on Floci; the light tier doesn't provision them. MFA is off (as on
  the light tier), the password is a printed throwaway, and Floci's Cognito is
  an emulator: advanced security, hosted-UI branding and token revocation
  details aren't AWS's. **Real AWS** uses the production tiers' user client,
  MFA and your own users. A local login proves the token path, not your
  production access model.

## The "ALB" is a reverse proxy

Locally, a reverse proxy path-routes `/api/*` + `/health` to the backend,
`/floci-cognito/` (the login calls) to Floci, and everything else to the
frontend. There is **no** TLS termination, WAF, or
health-based failover. **Real AWS** uses the actual ALB with all of that.

## IAM is not enforced

Floci creates roles and policies but doesn't evaluate them. A local run
succeeding proves nothing about least-privilege correctness. **Real AWS** enforces
IAM. A stack that works locally can still be denied there.

## KMS crypto and secret rotation don't run

KMS keys exist but encryption is effectively pass-through, and Secrets Manager
rotation doesn't run locally.

## No telemetry

There is no CloudWatch, X-Ray, or OTel pipeline locally. Cost, usage, and trace
features degrade to empty. The data those views need is produced by real AWS
telemetry.

## Agent invoke is a stub

Floci (2.2.0+) emulates the AgentCore control plane, so agents deploy
locally and definitions are manageable (Postgres). What's a stand-in is the data
plane: `invoke-agent-runtime` returns a canned response, not real agent reasoning.
See the [local guide](/loomster/guides/local/#agents-deploy-locally-invoke-is-a-stub).

## Floci is not a fidelity oracle

Floci proves synthesis, deployability, and that the web-tier workload runs. It is
**not** a substitute for a real-AWS run, and it doesn't validate anything in the
sections above. All three tiers have been deployed to a real account end to end —
`production` and `production-ha` both reach 7/7 stacks `CREATE_COMPLETE` with the
assistant runtime `READY` on Bedrock AgentCore. What Floci still can't stand in for
is real agent *execution* (invoke), which needs AgentCore on a live account. See the
[Tutorial](/loomster/getting-started/tutorial/#3-go-to-production).
