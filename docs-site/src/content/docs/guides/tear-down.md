---
title: Tear down a deployment
description: Delete one deployment's stacks with the gated teardown Op, then remove what it keeps on purpose, and get past the snags a production teardown hits.
claims: [teardown/covers-components]
prompt: |
  Read https://intentius.io/loomster/guides/tear-down/ and, for the deployment the person names, list its stacks and what teardown will leave behind.
  Run `chant run loom-teardown` only if the person asked for a teardown in this session, and stop at the gate; tell them the approval command.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

Every component stack of one [instance](/loomster/concepts/glossary/#instance)
deleted, then, if you choose, the snapshot, bucket and repositories it keeps.

## Prerequisites

The deployment's `LOOM_*` variables and AWS credentials with delete access.

## Steps

### 1. Run the Op

```
chant run loom-teardown                   # stops at the gate, exit 3
chant approve loom-teardown approve-loom-teardown
chant run loom-teardown                   # deletes this instance's stacks
```

After the gate it first deletes the AgentCore credential providers this Loom's
database records. Loom creates them outside every stack, and deleting only the
recorded ones leaves another instance's alone. Then it deletes the tunnel host
if you deployed one, since it sits on the network and the database. Then one
stack per component in `src/components/`, consumers first: the deploy waves
reversed, worked out from the graph when the [Op](/loomster/concepts/glossary/#op) is built, so a new component is
included without editing the Op. The order today is `loom-agents`,
`loom-backend`, `downstream-stub`, `loom-db`, `loom-frontend`, `loom-cognito`,
`shared-foundation`. It touches only `{project}-{env}-{instance}-*` stacks. A
failed delete stops the run; running it again resumes, since deleting a deleted
stack does nothing.

### 2. Remove what it keeps

Teardown leaves three things so it never destroys data or images you might want:

- the RDS final snapshot (`DeletionPolicy: Snapshot`);
- the S3 artifact bucket (`DeletionPolicy: Retain`), versioned;
- the ECR repositories.

When you're sure: delete the snapshot, empty the bucket including every version
and delete it, and `aws ecr delete-repository --force` each repository. Per-agent
role stacks from `loom-agent-role` and the hosted zone from `loom-dns-setup` are
outside the graph; delete them with `aws cloudformation delete-stack` and
`aws route53 delete-hosted-zone` once the provider's NS records are gone.

### 3. Production snags

The production [tiers](/loomster/concepts/tiers-and-instances/) protect
themselves, and AgentCore holds network interfaces after its stack is gone:

- RDS deletion protection: `loom-db` fails with "Cannot delete protected DB
  Instance." Run `aws rds modify-db-instance --db-instance-identifier <id> --no-deletion-protection --apply-immediately`.
- Cognito deletion protection: `loom-cognito` fails with "deletion protection is
  activated." Run `aws cognito-idp update-user-pool --user-pool-id <id> --deletion-protection INACTIVE`.
- Subnet group still in use: `dbRdsSubnetGroup` can fail while the instance
  drains. Wait until the instance is gone and run the teardown again; if the
  group outlives it, `aws rds delete-db-subnet-group --db-subnet-group-name <name>`.
- `shared-foundation` blocked by contents: it fails while the repositories hold
  images or the bucket holds objects. Empty them first.
- AgentCore network interfaces: in `VPC` mode AgentCore attaches managed
  interfaces to the ECS security group, and they linger after `loom-agents` is
  deleted, so the security group and `shared-foundation` fail with "has a
  dependent object." Only AWS releases them, often after tens of minutes.
  `loom-teardown` tries such a delete (and the subnet-group race above) up to 4
  times, 4 minutes apart. If they
  outlast that, watch
  `aws ec2 describe-network-interfaces --filters Name=group-id,Values=<ecs-sg>`
  and run the teardown again when it returns nothing. Nothing billable remains
  while you wait.

`test/production-live-e2e.sh`'s throwaway VPC, NAT gateway and Elastic IP are
left for you to delete after the stacks.

## Next

[Cost](/loomster/reference/cost/) for what keeps costing after a teardown.
