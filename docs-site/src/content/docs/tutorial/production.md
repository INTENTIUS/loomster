---
title: Go to production
description: Tutorial step 3. What the production tiers add over light, the network and domain they need from you, and the deploy that brings them up.
prompt: |
  Read https://intentius.io/loomster/tutorial/production/ and explain to the person which inputs their account still needs (VPC, subnets, domain, hosted zone, certificate) for the production tier.
  Check what exists with read-only AWS CLI calls and list what is missing.
  Deploy only if the person asked for a production deploy in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

`production` and `production-ha` are the same source as light with a different
[tier](/loomster/concepts/tiers-and-instances/). This page says what changes and
what you bring; [Deploy to production on AWS](/loomster/guides/deploy-to-production/)
is the full runbook.

## Result

Loom on your own network and domain over HTTPS, with PrivateLink, an RDS Proxy,
backend autoscaling, Cognito MFA and deletion protection. On production-ha also
Multi-AZ RDS, credential rotation and a two-task backend floor.

## Prerequisites

The production tiers don't build a network. PrivateLink needs private subnets,
and a loomster-built VPC only has public ones, so you bring:

- a VPC with two public and two private subnets across two AZs, with egress from
  the private subnets (a NAT gateway, or ECR, S3 and CloudWatch Logs endpoints)
  so tasks can pull images;
- a domain name, and either a Route53 hosted zone you own plus a DNS-validated
  ACM certificate, or a parent zone you can add NS records to.

## Steps

### 1. Set the inputs

```
export LOOM_TIER=production LOOM_ENV=prod LOOM_INSTANCE=a
export AWS_ACCOUNT_ID=<your account id>
export LOOM_VPC_ID=<vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<subnet>,<subnet>
export LOOM_PRIVATE_SUBNET_IDS=<subnet>,<subnet>
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_DB_PASSWORD=<a real secret>
```

`shared-foundation` stops with a message naming the missing variable if any of
the network inputs is unset on a production tier.

### 2. Choose how DNS is handled

If you already own the parent zone in Route53 and have a validated certificate,
reference both, and loomster creates no zone and no certificate:

```
export LOOM_HOSTED_ZONE_ID=<hosted zone id>
export LOOM_CERTIFICATE_ARN=<ACM certificate ARN>
```

Otherwise set only `LOOM_DOMAIN_NAME`; loomster creates the zone and
certificate, and `npm run dns-setup` walks the one manual step, the NS
delegation at your DNS provider ([Set up a custom domain](/loomster/guides/set-up-a-custom-domain/)).

### 3. Deploy

```
npm run vendor
just bootstrap                     # once per account, if light didn't run here
npx chant run --components all --env prod
```

The same commands as light. For a deploy behind your own change process, the
generated CI does the same run from `.github/workflows/deploy.yml`, inert until
you set the repo variable `DEPLOY` to `true` and give it a `production`
environment with AWS credentials ([Add CI to your forge](/loomster/guides/add-ci-to-your-forge/)).

### 4. Seed and validate

The production tiers' default seed profile is `foundation`, so seeding creates
nothing billable. The Cognito pool enforces MFA here, and
`scripts/validate/get-user-token.sh` completes the software-token setup for its
throwaway admin:

```
export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
LOOM_API_BASE_URL=https://loom.example.com npm run seed
LOOM_API_BASE_URL=https://loom.example.com npm run validate
bash scripts/validate/get-user-token.sh --delete
```

## Next

[Run your first Ops](/loomster/tutorial/operate/): production is where the gated
lifecycle [Ops](/loomster/concepts/glossary/#op) (upgrade, rotation, restore, teardown) matter.
