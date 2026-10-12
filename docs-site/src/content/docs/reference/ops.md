---
title: Ops
description: Every lifecycle Op in ops/, what it does, whether it stops at an approval gate, the inputs it reads, and how to run it.
---

Each [Op](/loomster/concepts/glossary/#op) is `ops/<name>.op.ts`, built by
`npm run ops:build` and run with `chant run <name>`. Every Op reads the
deployment it acts on from `LOOM_PROJECT`, `LOOM_ENV`, `LOOM_INSTANCE`,
`LOOM_TIER` and `AWS_REGION`, the same values you deployed with. How gates work
is in [Gated Ops](/loomster/concepts/gated-ops/).

## The Ops

| Op | What it does | Gate | Inputs beyond the deployment's |
|---|---|---|---|
| `loom-watch` | Drift detection: `chant lifecycle diff --live` across every stack; schedule every 15 minutes | none | |
| `loom-reconcile` | On drift, opens a pull request that brings the source in line with the cloud, for chant-owned resources only; never changes the cloud. Hourly schedule on the production [tiers](/loomster/concepts/tiers-and-instances/) | none | `GITHUB_TOKEN` in CI |
| `loom-upgrade-light` | Snapshot RDS, roll the backend (Loom migrates its schema on startup), roll the frontend | none | |
| `loom-upgrade-production` | As above, plus an approval gate before the backend roll, one-time Loom scripts, and an RDS restore on failure | `approve-loom-upgrade-production` | `LOOM_UPGRADE_SCRIPTS` |
| `loom-upgrade-production-ha` | The same for production-ha | `approve-loom-upgrade-production-ha` | `LOOM_UPGRADE_SCRIPTS` |
| `loom-rotate-production` | Rotate the Cognito M2M client, the RDS credential (a manual swap) and, with a custom domain, the ALB's ACM certificate | `approve-loom-rotate-production` | `LOOM_DOMAIN_NAME`, `LOOM_DB_USERNAME`, `LOOM_DB_NAME` |
| `loom-rotate-production-ha` | The same, rotating the RDS credential through its Secrets Manager rotation | `approve-loom-rotate-production-ha` | `LOOM_DOMAIN_NAME` |
| `loom-backup` | Labelled RDS snapshot, plus a cross-region copy | none | `LOOM_DR_REGION`, `LOOM_DR_KMS_KEY_ID` |
| `loom-restore-drill` | Restore a backup to a throwaway instance, check it comes up healthy, delete it | none | `LOOM_RESTORE_SNAPSHOT_ID` |
| `loom-restore` | Restore the database from a snapshot or a point in time to a new instance, then cut the backend over to it | `approve-loom-restore`, before the cutover | `LOOM_RESTORE_SNAPSHOT_ID` or `LOOM_RESTORE_TIME` |
| `loom-cognito-export` | Export the pool's users, groups and memberships to stdout, or to S3. Read-only | none | `LOOM_BACKUP_BUCKET` |
| `loom-teardown` | Delete the AgentCore credential providers this Loom's database records, then the tunnel host if deployed, then this instance's component stacks, consumers first; only what it owns | `approve-loom-teardown` | |
| `loom-bootstrap` | Once per account: create the ECS and AgentCore runtime-identity service-linked roles if they are missing | none | |
| `loom-tunnel-host` | Deploy the optional SSM tunnel host (`{project}-{env}-{instance}-tunnel-host`) in the private subnets, with ingress on the database's security group | none | `LOOM_TUNNEL_VPC_ID`, `LOOM_TUNNEL_SUBNET_IDS`, `LOOM_TUNNEL_DB_SG_ID`, `LOOM_TUNNEL_DB_PORT`, `LOOM_TUNNEL_INSTANCE_TYPE`, `LOOM_TUNNEL_SSM_ENDPOINTS` (all optional) |
| `loom-import-sqlite` | Upload a SQLite Loom database, import it into Postgres from a backend task, fix the sequences, delete the upload | `approve-loom-import-sqlite` | `LOOM_IMPORT_SQLITE`, `LOOM_IMPORT_SKIP_EXISTING` |
| `loom-fix-sequences` | Reset Postgres id sequences to each table's highest id, from a backend task | none | |
| `loom-reset-db` | Snapshot, then drop and recreate the schema and roll the backend | `approve-loom-reset-db` | |
| `loom-credentials` | List the AgentCore credential providers in the region and the ones this Loom recorded. Read-only | none | |
| `loom-credentials-delete` | Delete the credential providers this Loom recorded, and no others | `approve-loom-credentials-delete` | |
| `loom-memory` | Inspect AgentCore memory: list, get, records, records by namespace, extraction jobs. Read-only | none | `LOOM_MEMORY_QUERY`, `LOOM_MEMORY_ID`, `LOOM_MEMORY_ACTOR_ID`, `LOOM_MEMORY_NAMESPACE` |
| `loom-cognito-set-passwords` | Set a permanent password for named users, or every user still in `FORCE_CHANGE_PASSWORD` | none | `LOOM_COGNITO_PASSWORD`, `LOOM_COGNITO_USERS` |
| `loom-seed` | Register the agent role and a Cognito authorizer in Loom, plus demo content on the `demo` profile, through Loom's API | none | `LOOM_API_BASE_URL`, `LOOM_API_TOKEN`, `LOOM_SEED_PROFILE`, `LOOM_SEED_GROUP`, `LOOM_SEED_MODEL_ID`, `LOOM_DEMO_A2A_URL`, `LOOM_REGISTRY_ID` |
| `loom-agent-role` | Deploy one agent's execution role stack the way Loom's `role.yaml` does, and register it in Loom tagged into a group | none | `LOOM_AGENT_ROLE_AGENT`, `LOOM_AGENT_ROLE_GROUP`, `LOOM_API_BASE_URL`, `LOOM_API_TOKEN`; optional `LOOM_AGENT_ROLE_MEMORY_ARN`, `LOOM_AGENT_ROLE_CODE_INTERPRETER`, `LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS` |
| `loom-dns-setup` | Create the Route53 zone for a custom domain, print its NS records, and poll public DNS until the delegation resolves | none | `LOOM_DOMAIN_NAME` |
| `loom-audit` | Check every pinned `uses:` reference in `.github/workflows/` against upstream; report only | none | `GITHUB_TOKEN` for the API rate limit |

## Running them

```
chant run loom-backup                        # no gate
chant run loom-upgrade-production            # stops at the gate, exit 3
chant approve loom-upgrade-production approve-loom-upgrade-production
chant run loom-upgrade-production            # continues past the approved gate
chant run list                               # every Op and its last run
```

Several have `npm run` aliases: `watch`, `reconcile`, `audit`, `backup`,
`cognito-export`, `restore`, `restore-drill`, `dns-setup` and `seed`. `just`
has `watch`, `reconcile`, `audit`, `agent-role <agent> <group>`, `bootstrap`,
`tunnel-host`, `tunnel [port]`, `import-sqlite <file>`, `fix-sequences`,
`reset-db`, `credentials`, `credentials-delete`, `memory [query] [id] [who]`,
`set-passwords [users]`, `cognito-client-id` and `cognito-token`.
[Loom make targets](/loomster/reference/make-targets/) maps each to the `make`
target it replaces.

`loom-import-sqlite`, `loom-reset-db`, `loom-credentials-delete` and
`loom-cognito-set-passwords` are never run over [chant](/loomster/concepts/glossary/#chant)'s MCP server: a coding
agent connected to it can't run them or approve their gates.

## Guides per Op

- Upgrade: [Upgrade Loom](/loomster/guides/upgrade-loom/)
- Rotation: [Rotate credentials](/loomster/guides/rotate-credentials/)
- Backup, restore, the drill and the Cognito export: [Back up and restore](/loomster/guides/back-up-and-restore/)
- Watch and reconcile: [Watch and reconcile drift](/loomster/guides/watch-and-reconcile-drift/)
- Teardown: [Tear down a deployment](/loomster/guides/tear-down/)
- Seed: [Seed and validate a deploy](/loomster/guides/seed-and-validate/)
- Agent roles: [Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)
- DNS: [Set up a custom domain](/loomster/guides/set-up-a-custom-domain/)
- Tunnel host: [Open a tunnel to the database](/loomster/guides/open-a-tunnel-to-the-database/)
- Bootstrap: [Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/#1-deploy)
- Database, credential and memory Ops: [Loom make targets](/loomster/reference/make-targets/)
- Scheduling: [Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/)
