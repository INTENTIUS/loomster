# Local caveats


The local tier ([Run Loom on your laptop](./local.md)) is for development and to prove the stack deploys and the web tier runs. It is **not** a fidelity statement about real AWS, and several divergences are load-bearing. Each below says what's different, why, and what's true on real AWS instead.

## Secrets are plain environment variables

Floci's ECS does not inject Secrets Manager `Secrets` into containers. So the light tier delivers the database URL as a plain `Environment` var (built from loom-db's resolved endpoint). **Real AWS** uses Secrets Manager. Do not copy local secret handling into a real deployment — `production` / `production-ha` keep the secret.

## `Fn::Sub` GetAtt isn't resolved inside a SecretString

Related: Floci does not resolve `Fn::Sub ${LogicalId.Attribute}` GetAtt references inside a `SecretString` (it leaves the literal). That's why the light tier delivers the DB URL via a cross-stack input rather than the secret. loomster's secret template is correct for real AWS.

## Auth is a dev bypass, not a login

Floci's Cognito issues opaque tokens, not signed JWTs. The local tier engages Loom's built-in bypass (`local-dev` user, all scopes) instead of a real login. **Real AWS** uses real Cognito JWTs and real scope enforcement. A local success says nothing about your production access model.

## The "ALB" is a reverse proxy

Locally, a reverse proxy path-routes `/api/*` + `/health` to the backend and everything else to the frontend. There is **no** TLS termination, WAF, or health-based failover. **Real AWS** uses the actual ALB with all of that.

## IAM is not enforced

Floci creates roles and policies but does not evaluate them. A local run succeeding proves nothing about least-privilege correctness. **Real AWS** enforces IAM — a stack that works locally can still be denied there.

## KMS crypto and secret rotation don't run

KMS keys exist but encryption is effectively pass-through, and Secrets Manager rotation does not run locally.

## No telemetry

There is no CloudWatch, X-Ray, or OTel pipeline locally. Cost, usage, and trace features degrade to empty — the data those views need is produced by real AWS telemetry.

## Agents don't run

Bedrock AgentCore has no Floci emulation. Agent *definitions* are manageable (Postgres), but deploy/invoke is unavailable locally. See the [local guide](./local.md#agents-dont-run-locally).

## Floci is not a fidelity oracle

Floci proves synthesis, deployability, and that the web-tier workload runs. It is **not** a substitute for a real-AWS end-to-end run (tracked in `INTENTIUS/loomster#22`), and it does not validate anything in the sections above.
