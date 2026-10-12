---
title: Deploy the light tier to AWS
description: Tutorial step 2. Deploy the cheapest real Loom to an AWS account with one command, seed it, validate every screen behind real Cognito, and tear it down.
claims: [backend/deploy-agent, params/reach-deploy, teardown/covers-components]
prompt: |
  Read https://intentius.io/loomster/tutorial/light-on-aws/ and follow it in this checkout, only if the person asked you to deploy to their AWS account in this session.
  Confirm the account with `aws sts get-caller-identity` and show it to the person before deploying.
  Deploy, seed with the foundation profile, validate, and report the ALB address and each screen's verdict.
  Stop at the teardown gate and tell the person the approval command to run.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

The light [tier](/loomster/concepts/tiers-and-instances/) is the cheapest real
deployment: HTTP on the ALB's own DNS name, single-AZ RDS, and a VPC it builds
itself. You need an account and nothing from a platform team.

## Result

Loom on a real ALB, RDS and Cognito, with the agent role and a Cognito
authorizer registered in Loom, every screen validated through a real token, and
a way to delete all of it.

## Prerequisites

- An AWS account and credentials the AWS CLI resolves (a profile, SSO or
  exported keys). The deploy creates IAM roles, so the credentials need IAM
  write access.
- Bedrock AgentCore and model access in the region, for the agents wave.
- Docker, to build Loom's images. Node.js 22 or later, `npm install` run.

## Steps

### 1. Deploy

```
export LOOM_TIER=light LOOM_ENV=dev LOOM_INSTANCE=a
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export LOOM_DB_PASSWORD=<a real secret, not a literal in any file>
npm run vendor                            # fetch Loom v1.9.0 for the image builds
just bootstrap                            # once per account
npx chant run --components all --env dev
```

`just bootstrap` runs `loom-bootstrap`, which creates the two service-linked
roles a fresh account may lack, for ECS and for AgentCore Runtime's workload
identity (Loom's `make ecs.init` and `make agentcore.init`). It creates only
what's missing, so running it again changes nothing. It needs
`iam:CreateServiceLinkedRole` the first time.

`--components all` deploys every component in graph order, each synthesizing
its template from these variables and handing its outputs to the next. It builds
and publishes the frontend and backend images by digest.

On Apple Silicon, also set `LOOM_CPU_ARCHITECTURE=ARM64`. Fargate defaults to
`X86_64`, and an arm64 image on an x86 task exits at once. `ARM64` runs the
tasks on Graviton to match the image.

The agents wave runs last. If AgentCore isn't available in the region, that
stack fails after the app is already serving; everything through `loom-backend`
stands on its own.

### 2. Check it serves

```
ALB=$(aws cloudformation describe-stacks --stack-name loom-dev-a-shared-foundation \
  --query "Stacks[0].Outputs[?OutputKey=='oDomainName'].OutputValue" --output text)
curl -s -o /dev/null -w '%{http_code}\n' http://$ALB/health    # 200
```

### 3. Get a token

Loom checks a Cognito token on every API call. Mint one for a throwaway admin
through the pool's end-user client (`bash scripts/validate/get-user-token.sh
--delete` removes the user afterwards):

```
export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
```

The served web app at `http://$ALB` signs in through the same client. The pool
starts with no users; [Add the first admin](/loomster/guides/add-the-first-admin/)
to sign in there yourself.

### 4. Seed and validate

```
export LOOM_API_BASE_URL=http://$ALB
LOOM_SEED_PROFILE=foundation npm run seed
LOOM_SEED_PROFILE=foundation npm run validate
```

`foundation` imports the shared agent role and registers a Cognito authorizer,
which is what an agent deploy needs. The light tier's default profile is `demo`,
which also deploys an agent, creates a memory, invokes the agent and runs an
evaluation; on a real account those are billable. [Screens](/loomster/reference/screens/)
lists what each profile writes.

Then remove the throwaway user:

```
bash scripts/validate/get-user-token.sh --delete
```

### 5. Tear it down

```
chant run loom-teardown                   # stops at the gate, exit 3
chant approve loom-teardown approve-loom-teardown
chant run loom-teardown                   # deletes this instance's stacks
```

Teardown deletes one stack per component, consumers first, and only this
[instance](/loomster/concepts/glossary/#instance)'s. It leaves the RDS final
snapshot, the S3 artifact bucket and the ECR repositories on purpose.
[Tear down a deployment](/loomster/guides/tear-down/) covers removing those.

## Next

[Go to production](/loomster/tutorial/production/).
