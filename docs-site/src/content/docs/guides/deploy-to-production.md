---
title: Deploy to production on AWS
description: The runbook for putting the production or production-ha tier on a real AWS account, from DNS delegation and the network through the deploy to an authenticated validation, plus the scripted end-to-end run.
prompt: |
  Read https://intentius.io/loomster/guides/deploy-to-production/ and check the person's account against its Prerequisites with read-only AWS CLI calls.
  List what is missing. Deploy only if the person asked for a production deploy in this session, and then follow the Steps.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

`production` or `production-ha` serving Loom over HTTPS on your domain, with the
foundation seeded and every screen check passing through a real token.

## Prerequisites

- An AWS account with Bedrock AgentCore and model access in the region, and
  credentials with IAM write access.
- A VPC with public and private subnets in two AZs. Fargate tasks on the
  production [tiers](/loomster/concepts/tiers-and-instances/) get no public IP, so
  the private subnets need egress to pull images: a NAT gateway, or ECR, S3 and
  CloudWatch Logs endpoints.
- A domain, and access to the DNS provider of its parent.
- Docker for the image builds, Node.js 22 or later, `npm install` run.

## Steps

### 1. Delegate the domain

Skip this if you reference an existing hosted zone and certificate
(`LOOM_HOSTED_ZONE_ID`, `LOOM_CERTIFICATE_ARN`). Otherwise the stack creates a
certificate validated by DNS in a new zone, and that only works once the parent
delegates to it:

```
LOOM_DOMAIN_NAME=loom.example.com npm run dns-setup
```

`loom-dns-setup` creates the zone (or adopts an existing one), prints its id and
four NS records, then polls public DNS. Add one `NS` record named
`loom.example.com` at the parent's DNS provider with those four values; the [Op](/loomster/concepts/glossary/#op)
finishes once `dig +short NS loom.example.com` returns them. Keep the printed
zone id. [Set up a custom domain](/loomster/guides/set-up-a-custom-domain/) has
the other DNS options.

### 2. Set the inputs

```
export LOOM_TIER=production            # or production-ha
export LOOM_ENV=prod LOOM_INSTANCE=a
export AWS_ACCOUNT_ID=<account id>
export LOOM_VPC_ID=vpc-...
export LOOM_PUBLIC_SUBNET_IDS=subnet-...,subnet-...
export LOOM_PRIVATE_SUBNET_IDS=subnet-...,subnet-...
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_HOSTED_ZONE_ID=Z...        # from step 1
export LOOM_DB_PASSWORD=<from your secret store>
export LOOM_CPU_ARCHITECTURE=ARM64     # match your built images
```

### 3. Deploy

```
npm run vendor
just bootstrap                     # once per account: ECS and AgentCore service-linked roles
npx chant run --components all --env prod
```

### 4. Seed and validate

Loom checks a Cognito token on every call, and loomster seeds no users.
`scripts/validate/get-user-token.sh` creates a throwaway user in `t-admin` and
`g-admins-super`, signs in with `ADMIN_USER_PASSWORD_AUTH` and prints the access
token. If the pool requires MFA (`LOOM_COGNITO_MFA=ON`), it also registers a
software token, computes the TOTP code and answers the challenge.

```
export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
export LOOM_API_BASE_URL=https://loom.example.com
npm run seed
npm run validate
bash scripts/validate/get-user-token.sh --delete
```

The throwaway user is for this check only. Don't leave it on a real tenant.

### 5. Run it as one script instead

`just production-live-e2e` (or `just production-ha-live-e2e`) does steps 3 and 4
and asserts every tier resource exists live: RDS Proxy, the PrivateLink endpoint
service, the certificate, the alias record, backend autoscaling, the agent
runtime, and on production-ha the rotation schedule. Without `LOOM_VPC_ID` it
builds a throwaway VPC with a NAT gateway. It stops at a human gate first: type
`run` in your terminal. A coding agent can run it only under a grant you give
it, `just grant e2e/production-live` ([Claims](/loomster/reference/claims/#the-gate-and-grants)).
`LOOM_E2E_TEARDOWN=1` deletes the stacks at the end.

## Next

- [Run your first Ops](/loomster/tutorial/operate/) and
  [Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/).
- [Tear down a deployment](/loomster/guides/tear-down/) lists the snags a
  production teardown hits.
- [Cost](/loomster/reference/cost/) before you leave it running.
