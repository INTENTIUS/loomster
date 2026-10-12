---
title: Upgrade Loom
description: Move the pinned Loom release, run the tier's upgrade Op, which snapshots the database and rolls the backend and frontend, and run the one-time scripts and manual steps a release needs, including v1.6 to v1.9.
prompt: |
  Read https://intentius.io/loomster/guides/upgrade-loom/ and, for the Loom release the person names, update the pin in scripts/vendor-loom.sh and the version mentions, run `npm run vendor`, and summarize the upstream release notes for the range.
  Open a pull request with the pin change. Run an upgrade Op only if the person asked for it in this session, and stop at its gate.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

The deployment running a new Loom release, its schema migrated, with a
pre-upgrade snapshot to fall back on.

## Prerequisites

The deployment's `LOOM_*` variables and AWS credentials, Docker for the image
builds, and the upstream release notes and `DEPLOYMENT.md` for the range you're
crossing.

## Steps

### 1. Move the pin

The pin in `scripts/vendor-loom.sh` is a tag plus the commit it must resolve to:

```
git ls-remote --tags https://github.com/awslabs/loom 'refs/tags/v1.9.0^{}'
# a3050669f5b4c83210a44ed4346f17e01641e82f  refs/tags/v1.9.0^{}
```

Update `LOOM_TAG` and `LOOM_EXPECTED_SHA`, and the version in `README.md`,
`package.json` and the `justfile`. Then fetch:

```
npm run vendor
```

The script fails if the tag moved, if `backend/Dockerfile`, `backend/scripts/`
or the agent sources are missing, if a patch in `scripts/loom-patches/` no
longer applies, or if `backend/Dockerfile` lost its `COPY backend/app/ ./app/`
line. loomster adds `COPY backend/scripts/ ./scripts/` after that line so the
image carries Loom's maintenance scripts.

Keep `vendor/loom` for the upgrade run, and remove it before `chant lint .`,
which would otherwise lint it as project code.

### 2. Write the schema migration

Loom has no migration tool: when a backend task starts, it creates new tables
and adds new columns. loomster hands that to SQL Yodeler, so a release's schema
change is a migration you write and review with the pin change:

```
just db-schema                 # the new version's schema, from its own init_db
just db new loom-v1.10.0       # the migration
just db lint && just db-replay
```

[Migrate Loom's database](/loomster/guides/migrate-the-database/) covers this,
the read-only user and the baseline a deployment records once.

### 3. Run the upgrade Op

| [Tier](/loomster/concepts/tiers-and-instances/) | Phases | On failure |
|---|---|---|
| `light` | Preflight, Snapshot, Schema, Backend, Apply | the component's own rollback to the previous task definition |
| `production`, `production-ha` | Preflight, Policy, Snapshot, Approve, Schema, Backend, Apply, Scripts | Rollback restores the pre-upgrade snapshot to a new instance |

Preflight stops the run before anything changes when the AWS credentials don't
resolve (or resolve to another account than `AWS_ACCOUNT_ID`), when one of the
five stacks is mid-change or failed, or when the schema step couldn't run: on
AWS it needs the Session Manager plugin and the tunnel host, and on every
target a recorded baseline with no checksum mismatch (`just db status`). It
also prints `chant lifecycle whoami`, which reports static keys only, so a
profile or SSO session shows as unresolved there and is still accepted.

Policy, on the production tiers, builds the backend and frontend templates and
checks them against loomster's CloudFormation Guard rules
(`policies/production.guard`). It needs `cfn-guard` on your `PATH`, or
`CFN_GUARD` naming it. `just policy` checks the rules against every
production-tier template, and that each rule still catches what it should.

Schema applies the pending migrations (`just db apply`) behind yodel's own gate,
which is bound to the plan digest, while the old backend still serves. Backend
rolls the new backend, `chant run --components loom-backend`, whose startup
migration then finds nothing to do. Apply rolls the frontend, and Scripts runs
the one-time scripts. The [Op](/loomster/concepts/glossary/#op)'s gate sits before Schema, the point of no return
for the schema.

Approve the schema plan at your terminal before the run, from a machine that
reaches the database (on AWS, through the tunnel host):

```
just db plan
just db approve                            # shows the plan; type the deployment's name

chant run loom-upgrade-light               # light: no Op gate

export LOOM_UPGRADE_SCRIPTS="migrate_oauth2_secrets.py --apply"
chant run loom-upgrade-production          # stops at Approve, exit 3
chant approve loom-upgrade-production approve-loom-upgrade-production
chant run loom-upgrade-production          # snapshots again, then continues
```

If you didn't approve the schema plan first, Schema stops at yodel's gate
(exit 3) with the command to run; approve, then run the Op again. Schema
also stops (exit 4) on a deployment whose history records no migration yet:
record the baseline first (`just db baseline`).

Each component synthesizes its own template from your variables, so there is no
separate synth step. Snapshot names the snapshot `<db-instance>-upgrade-<timestamp>`
and waits for it.

If a gated run fails after the snapshot, Rollback restores the latest manual
snapshot to `<db-instance>-restored-<timestamp>` without cutting over. To get the
pre-upgrade data back, cut over with `loom-restore`
(`LOOM_RESTORE_SNAPSHOT_ID=<the -upgrade- snapshot>`,
[Back up and restore](/loomster/guides/back-up-and-restore/)). The backend's own
rollback puts the previous task definition back but doesn't undo the schema.

With several deployments, roll the upgrade tier by tier with [chant](/loomster/concepts/glossary/#chant)'s Op waves:
`ops/waves/upgrade.json` runs the light deployment, then production, then
production-ha, each wave only after the one before it applied. Each run's
target is `<env>.<instance>`; edit the file to list your deployments.

```
npx chant run wave --spec ops/waves/upgrade.json --wave 1   # light: dev.a
npx chant run wave --spec ops/waves/upgrade.json --wave 2   # production: staging.a
npx chant run wave --spec ops/waves/upgrade.json --wave 3   # production-ha: prod.a
```

The waves don't add a gate of their own. Each production run stops at its
upgrade Op's gate (exit 3) as a direct `chant run` does; approve it with
`chant approve`, then run the wave again. `ops/waves/rotate.json` does the same
for credential rotation across the two production tiers.

### 4. Run one-time scripts

On the production tiers, list them in `LOOM_UPGRADE_SCRIPTS`, comma-separated,
each a script name (`.py` optional) and its arguments:

```
LOOM_UPGRADE_SCRIPTS="migrate_oauth2_secrets.py --apply,drop_permission_requests.py --apply"
```

Each runs in order as a one-off Fargate task from the backend service's current
task definition (its image, task role, environment, secrets and network), as
`python -m scripts.<name> [args]` from `/app`. Its log output is printed, and the
first non-zero exit fails the phase.

On light, run one by hand:

```
CLUSTER=<project>-<env>-<instance>-shared-foundation-cluster
SERVICE=<project>-<env>-<instance>-loom-backend-backend-svc
TD=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].taskDefinition' --output text)
NET=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].networkConfiguration' --output json)
aws ecs run-task --cluster $CLUSTER --task-definition $TD --launch-type FARGATE \
  --network-configuration "$NET" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["python","-m","scripts.migrate_oauth2_secrets","--apply"]}]}'
```

## From v1.6 to v1.9

Three changes in v1.9.0 need attention.

OAuth2 client secrets move to Secrets Manager. MCP and A2A OAuth2 client secrets
leave the database for `loom/mcp/{id}/...` and `loom/a2a/{id}/...`. The backend
moves a row the first time its secret is used; `migrate_oauth2_secrets.py --apply`
moves all of them and clears the column, reading each secret back first. Without
`--apply` it only reports. The backend task role grants the `secret:loom/*`
access both paths need ([Security](/loomster/reference/security/#backend-task-role)).

Loom no longer creates IAM roles. An agent can't deploy without a `role_arn`
registered under Security > IAM roles and tagged into its group. Agents whose
role an older Loom created won't redeploy until that role is registered. List
them before upgrading and register each role after. loomster's task role never
had IAM write access, so such roles are unlikely here. Integrations (S3, Lambda,
DynamoDB) now record configuration only; add the IAM statement to the agent's
role ([Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)).

Permission requests are gone. `drop_permission_requests.py --apply` drops the
unused `permission_requests` table and its history. Run it before recording the
yodel baseline on a deployment that came from v1.6: v1.9.0's schema has no such
table, and `just db baseline` refuses a database that holds one.

`fix_sequences.py` isn't needed for an upgrade or for `loom-restore`, whose
snapshot and point-in-time restores are physical copies. It's in the image for a
logical data load: `LOOM_UPGRADE_SCRIPTS=fix_sequences.py`.

## Next

[Validation](/loomster/reference/validation/) to rerun `just validate` against the
upgraded deployment, and [What's new](/loomster/reference/whats-new/).
