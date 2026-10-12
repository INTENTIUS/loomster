---
title: Bring your own KMS, ECR and database
description: Point loomster at a KMS key, ECR repositories and a Postgres endpoint you already run, or leave the key and repositories out, through build parameters.
prompt: |
  Read https://intentius.io/loomster/guides/bring-your-own-kms-ecr-and-database/ and look up the key, repositories and database the person names with read-only AWS CLI calls.
  Report the variables to export for each, and any of them that doesn't meet the page's requirements.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A deployment that uses your key, repositories and database, creating none of
them.

## Prerequisites

The resources, in the deploy region, and their ids or ARNs.

## Steps

Each piece is its own [seam](/loomster/concepts/glossary/#seam); set any one
without the others.

### KMS key

The key encrypts the two ECR repositories.

```
export LOOM_KMS_KEY_ARN=<key ARN>     # reference yours
export LOOM_KMS=omit                  # or: no customer-managed key
```

### ECR repositories

Set all four, or none; a partial set is ignored.

```
export LOOM_FRONTEND_REPOSITORY_URI=<uri> LOOM_FRONTEND_REPOSITORY_ARN=<arn>
export LOOM_BACKEND_REPOSITORY_URI=<uri>  LOOM_BACKEND_REPOSITORY_ARN=<arn>
```

The frontend and backend images publish to the repositories `shared-foundation`
outputs, yours when referenced. `LOOM_ECR=omit` drops the repositories and their
outputs.

### Database

Any Postgres endpoint Loom's backend can reach: RDS, Aurora or another.

```
export LOOM_DB_MODE=reference-existing
export LOOM_DB_ENDPOINT=<host>
export LOOM_DB_CREDENTIALS_SECRET_ARN=<secret with the credentials>
export LOOM_DB_PORT=5432                            # optional
export LOOM_DB_NAME=loom                            # optional
export LOOM_DB_CONNECTION_SECRET_ARN=<secret ARN>   # optional, a secret holding the connection URL
```

`loom-db` then creates nothing and passes the endpoint and secrets to
`loom-backend`. The backend's task role gets `secretsmanager:GetSecretValue` on
that secret. A fully referenced `loom-db` stack has no resources of its own.

The backup, restore and upgrade [Ops](/loomster/reference/ops/) act on the
database loomster creates. With your own database, back it up and restore it
your way.

When loomster does provision the database, `LOOM_DB_ALLOWED_CIDR` narrows the
ingress CIDR (`10.0.0.0/8` when unset), or `LOOM_DB_SOURCE_SG=true` admits only
the ECS task security group.

## Next

[Bring your own everything](/loomster/guides/bring-your-own-everything/) sets
every seam at once.
