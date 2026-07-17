---
title: Production on real AWS
description: The runbook for applying the production and production-ha tiers to a real AWS account — DNS delegation for a custom domain, the bring-your-own network, the deploy, live validation, and teardown.
---

The Floci production E2E proves the prod tiers synthesize and deploy against an
emulator. This is the real-account runbook: a custom domain with a validated
certificate, a bring-your-own network with egress, the deploy, an authenticated
screen validation, and teardown. It applies to `production` and `production-ha`.

`test/production-live-e2e.sh [production|production-ha]` runs the deploy and the
assertions; this page covers the one-time setup around it.

## 1. Delegate the domain

Production serves on a custom domain and provisions an ACM certificate that is
DNS-validated into a Route53 zone. For validation to succeed the zone must be
delegated from the parent domain, which is a step at whatever DNS provider is
authoritative for the parent — you do it once, by hand.

The `loom-dns-setup` Op automates the AWS side and waits for you to do the provider
side:

```
LOOM_DOMAIN_NAME=loom.example.com npm run dns-setup
```

It runs two phases on the local executor:

1. **EnsureZone** — creates the Route53 hosted zone for the domain (idempotent; a
   re-run adopts the existing zone), then prints the `LOOM_HOSTED_ZONE_ID` and the
   four `NS` records.
2. **AwaitDelegation** — polls public DNS until the delegation resolves.

Between the two, add the printed records at your DNS provider. For a subdomain like
`loom.example.com` under a parent `example.com`, that is one `NS` record:

| Field | Value |
|---|---|
| Name | `loom.example.com` (or `loom`, depending on the provider's UI) |
| Type | `NS` |
| Value | the four `ns-*.awsdns-*` servers the Op printed |

The Op continues on its own once `dig +short NS loom.example.com` returns those
servers. It waits rather than asking for a click on purpose — a real chant `gate()`
needs the durable (`--temporal`) runtime, and a DNS delegation has an observable
completion condition, so a poll is both local-runnable and safer than approving
before propagation.

Keep the `LOOM_HOSTED_ZONE_ID` it printed; the deploy references it.

## 2. Bring-your-own network

Production requires a referenced VPC (the provisioned-network path is light-only) with
public and private subnets across two AZs. Private-subnet Fargate tasks run with
`AssignPublicIp: DISABLED`, so the private subnets need egress to pull images from
ECR — a **NAT gateway** or ECR/S3/logs VPC endpoints.

If you don't pass `LOOM_VPC_ID`, the E2E script provisions a throwaway VPC with a NAT
gateway for you. To use your own, export:

```
export LOOM_VPC_ID=vpc-...
export LOOM_PUBLIC_SUBNET_IDS=subnet-...,subnet-...
export LOOM_PRIVATE_SUBNET_IDS=subnet-...,subnet-...
```

## 3. Deploy and validate

```
export LOOM_HOSTED_ZONE_ID=Z...          # from step 1
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_DB_PASSWORD=...
export LOOM_CPU_ARCHITECTURE=ARM64       # match your built images (ARM64 on Apple Silicon)

just production-live-e2e                  # or: production-ha-live-e2e
```

The script vendors Loom, synthesizes, deploys all seven stacks, then asserts:

- all 7 stacks reach `CREATE_COMPLETE` / `UPDATE_COMPLETE`,
- the tier-distinguishing resources exist live — RDS Proxy, PrivateLink VPC endpoint
  service, ACM certificate, Route53 alias record, backend autoscaling, both agent
  runtimes (`production-ha` also asserts the credential-rotation schedule),
- the app is served at `https://<domain>`,
- every screen validates behind real Cognito auth.

## 4. Teardown

Set `LOOM_E2E_TEARDOWN=1` to delete the stacks at the end. The throwaway VPC, its NAT
gateway, and the EIP are left for manual cleanup (deleting them mid-run would strand
the stacks). RDS leaves a final snapshot (`DeletionPolicy: Snapshot`), and the S3
artifact bucket and ECR repos are retained — empty and delete them by hand. The
hosted zone costs about $0.50/month; keep it for the next run or delete it once you
remove the provider-side delegation.

Three teardown snags on the prod tiers, in order:

- **RDS deletion protection.** Production enables it (a correct default), so
  `loom-db` delete fails with "Cannot delete protected DB Instance." Disable it first:
  `aws rds modify-db-instance --db-instance-identifier <id> --no-deletion-protection --apply-immediately`.
- **Subnet-group / instance race.** `dbRdsSubnetGroup` can fail to delete while the
  instance is still draining ("still using it"). Wait for the instance to be gone,
  then re-run the stack delete.
- **Orphaned subnet group.** If the group outlives the instance and the stack retry
  still fails, delete it directly (`aws rds delete-db-subnet-group --db-subnet-group-name <name>`)
  and delete the stack once more.
- **shared-foundation blockers.** Its delete fails while the ECR repos hold images or
  the artifact bucket holds objects — empty the bucket (all versions) and
  force-delete the repos (`aws ecr delete-repository --force`) first.

## Cost

Real resources accrue for the run's duration. `production-ha` is materially more than
`production` — Multi-AZ RDS, RDS Proxy, the NLB, two Fargate tasks, and the agent
runtimes. Tear down promptly.
