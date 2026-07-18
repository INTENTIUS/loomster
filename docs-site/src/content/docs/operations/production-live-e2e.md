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

### Authenticated screen validation

Real Cognito rejects unauthenticated requests, and loomster seeds no users, so the
screens need a real token. Loom derives a user's scopes from their `cognito:groups`
claim, and an admin needs the `t-admin` type group plus one `g-admins-*` group.
`scripts/validate/get-user-token.sh` does this end to end against the deployed pool:
it creates those two groups (idempotent), a throwaway user, adds it to both, then
uses `ADMIN_USER_PASSWORD_AUTH` (the user client enables it) to return an access
token. The harness mints and deletes this user automatically — set
`LOOM_E2E_MINT_USER=0` to skip, or export your own `LOOM_API_TOKEN` to override. To
drive it by hand against a live deployment:

```
export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
LOOM_API_BASE_URL=https://loom.example.com npm run validate
bash scripts/validate/get-user-token.sh --delete   # remove the throwaway user
```

The user is E2E-only. A real deployment brings its own users — never leave this one
on a real tenant.

## 4. Teardown

Set `LOOM_E2E_TEARDOWN=1` to delete the stacks at the end. The throwaway VPC, its NAT
gateway, and the EIP are left for manual cleanup (deleting them mid-run would strand
the stacks). RDS leaves a final snapshot (`DeletionPolicy: Snapshot`), and the S3
artifact bucket and ECR repos are retained — empty and delete them by hand. The
hosted zone costs about $0.50/month; keep it for the next run or delete it once you
remove the provider-side delegation.

Teardown snags on the prod tiers, in order:

- **RDS deletion protection.** Production enables it (a correct default), so
  `loom-db` delete fails with "Cannot delete protected DB Instance." Disable it first:
  `aws rds modify-db-instance --db-instance-identifier <id> --no-deletion-protection --apply-immediately`.
- **Cognito deletion protection.** Same story for the user pool — `loom-cognito`
  delete fails with "deletion protection is activated." Disable it:
  `aws cognito-idp update-user-pool --user-pool-id <id> --deletion-protection INACTIVE`,
  then delete the stack.
- **Subnet-group / instance race.** `dbRdsSubnetGroup` can fail to delete while the
  instance is still draining ("still using it"). Wait for the instance to be gone,
  then re-run the stack delete.
- **Orphaned subnet group.** If the group outlives the instance and the stack retry
  still fails, delete it directly (`aws rds delete-db-subnet-group --db-subnet-group-name <name>`)
  and delete the stack once more.
- **shared-foundation blockers.** Its delete fails while the ECR repos hold images or
  the artifact bucket holds objects — empty the bucket (all versions) and
  force-delete the repos (`aws ecr delete-repository --force`) first. The artifact
  bucket also has `DeletionPolicy: Retain`, so CFN `DELETE_SKIPPED`s it — delete it by
  hand.
- **AgentCore ENIs hold the ECS security group.** The agents run in `VPC` network
  mode on `shared-foundation`'s ECS security group, and Bedrock AgentCore attaches two
  managed (`agentic_ai` / `ela-attach`) ENIs to it. When the agents stack is deleted —
  **on a clean delete, not only a rollback** — those ENIs linger, so `foundationEcsSg`
  (and thus `shared-foundation`) fails to delete with "has a dependent object." You
  can't detach or delete an `ela-attach` ENI ("You are not allowed to manage
  'ela-attach' attachments") — only AWS releases them, on its own schedule (tens of
  minutes, sometimes longer). Poll `aws ec2 describe-network-interfaces
  --filters Name=group-id,Values=<ecs-sg>` and re-run the `shared-foundation` delete
  once it returns none. This is the slowest part of a prod teardown; nothing billable
  remains while you wait (the ALB/ECS/RDS are already gone — only the SG, its ENIs, and
  the empty VPC linger, all free).

## Cost

Real resources accrue for the run's duration. `production-ha` is materially more than
`production` — Multi-AZ RDS, RDS Proxy, the NLB, two Fargate tasks, and the agent
runtimes. Tear down promptly.
