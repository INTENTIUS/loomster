---
title: Upgrade
description: Bumping the pinned Loom release, running the upgrade Op on each tier, how Loom migrates its schema, and the one-time scripts and manual steps for v1.6 to v1.9.
---

loomster deploys a pinned Loom release. Upgrading means moving the pin, then
running the tier's upgrade Op, which snapshots the database, rolls the backend
and frontend onto images built from the new source, and (on production tiers)
runs any one-time scripts the release asks for.

## How Loom migrates

Loom has no migration tool and no Alembic. When a backend task starts,
`app.db:init_db` runs SQLAlchemy `create_all` for new tables and
`_migrate_add_columns` for new columns on existing ones. The schema is
migrated by the first new task that comes up. There is no separate migration
command to run.

So the upgrade Op's **Migrate** phase is the backend roll itself:
`chant run --components loom-backend` builds the image from `vendor/loom`,
publishes it, deploys the stack with the new task definition, then waits for
the service to reach steady state and for `/health` to pass through the ALB.
A healthy new task is one that has already migrated.

Phases per tier:

| Tier | Phases | On failure |
|---|---|---|
| `light` | Snapshot, Migrate, Apply | nothing extra (the component's own `rollback-previous` still applies) |
| `production`, `production-ha` | Snapshot, Approve, Migrate, Apply, Scripts | Rollback: restore the pre-upgrade snapshot to a new instance |

Migrate rolls the backend, Apply rolls the frontend, Scripts runs the one-time
scripts below. The approval gate sits before Migrate because rolling the
backend is the point of no return for the schema.

## 1. Bump the Loom pin

The pin lives in `scripts/vendor-loom.sh` as a tag plus the commit it must
resolve to:

```bash
git ls-remote --tags https://github.com/awslabs/loom 'refs/tags/v1.9.0^{}'
# a3050669f5b4c83210a44ed4346f17e01641e82f  refs/tags/v1.9.0^{}
```

Update `LOOM_TAG` and `LOOM_EXPECTED_SHA` in the script, and the `v1.x.y`
mentions in `README.md`, `package.json` and the `justfile`. Then fetch:

```bash
npm run vendor
```

The script fails if the tag moved, if `backend/Dockerfile`, `backend/scripts/`
or the agent sources are missing, or if `backend/Dockerfile` no longer has the
`COPY backend/app/ ./app/` line. That last check exists because loomster adds
one line after it, `COPY backend/scripts/ ./scripts/`, so the backend image
carries Loom's maintenance scripts. Nothing else in the image changes.

Read the upstream release notes and `DEPLOYMENT.md` for the range you're
crossing before going further. Some releases need manual steps (see below).

Keep `vendor/loom` in place for the upgrade run (the Migrate and Apply phases
build from it), and remove it before `chant lint .`.

## 2. Run the upgrade Op

Export the same deployment variables you deploy with (`LOOM_ENV`,
`LOOM_INSTANCE`, `AWS_REGION`, network and domain settings), then:

```bash
# light: no gate
chant run loom-upgrade-light

# production / production-ha: stops at Approve (exit 3) until approved
export LOOM_UPGRADE_SCRIPTS="migrate_oauth2_secrets.py --apply"
chant run loom-upgrade-production
chant approve loom-upgrade-production approve-loom-upgrade-production
chant run loom-upgrade-production    # snapshot again, then past the gate
```

Each component deploy synthesizes its own template from these variables first
(the components' `Synth` phase), so there is no separate `npm run synth` step.

Swap `production` for `production-ha` on that tier. The Snapshot phase takes a
manual RDS snapshot named `<db-instance>-upgrade-<timestamp>` and waits for it
before anything else runs.

If a gated run fails after the snapshot, the Rollback phase restores the most
recent manual snapshot to a new `<db-instance>-restored-<timestamp>` instance.
It does not cut over to it. If you need the pre-upgrade data back, cut over with
`loom-restore` (`LOOM_RESTORE_SNAPSHOT_ID=<the -upgrade- snapshot>`), see
[Backup & restore](/loomster/operations/backup-restore/). A failed backend roll
is also undone by the component's own `rollback-previous`, which puts the
previous task definition back. That does not roll the schema back: tables and
columns the new version added stay in the database.

## 3. One-time scripts

Releases occasionally ship scripts under `backend/scripts/` for an operator to
run once. On production tiers, list them in `LOOM_UPGRADE_SCRIPTS` and the
Scripts phase runs each one after the roll:

```
LOOM_UPGRADE_SCRIPTS="migrate_oauth2_secrets.py --apply,drop_permission_requests.py --apply"
```

Entries are comma-separated; each is a script name (`.py` optional) followed
by its arguments. Each runs as a one-off Fargate task from the backend
service's current task definition, so it has the backend's image, task role,
environment, secrets and network (subnets and security groups are read from
the service at run time). The command is `python -m scripts.<name> [args]`
from `/app`, the form upstream documents. Scripts run in order. The task's
CloudWatch log output is printed, and the first non-zero exit code fails the
phase. Unset or empty means the phase does nothing.

On `light` there is no Scripts phase. Run a script by hand against the
backend service:

```bash
# names as derived in ops/lib/stack-refs.ts
CLUSTER=<project>-<env>-<instance>-shared-foundation-cluster
SERVICE=<project>-<env>-<instance>-loom-backend-backend-svc
TD=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].taskDefinition' --output text)
NET=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].networkConfiguration' --output json)
aws ecs run-task --cluster $CLUSTER --task-definition $TD --launch-type FARGATE \
  --network-configuration "$NET" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["python","-m","scripts.migrate_oauth2_secrets","--apply"]}]}'
```

## v1.6 to v1.9

Both breaking changes below land in v1.9.0.

### OAuth2 client secrets move to Secrets Manager

v1.9.0 stops keeping MCP and A2A OAuth2 client secrets in the database. They
live in Secrets Manager under `loom/mcp/{id}/...` and `loom/a2a/{id}/...`. The
backend moves a row lazily the first time its secret is used, and
`migrate_oauth2_secrets.py` moves all of them at once and clears the column.
Without `--apply` it only reports. It is safe to re-run, and it reads each
secret back before clearing the database copy.

Both paths need the backend task role to create, write and read
`secret:loom/*`. That grant is being added under
[#1](https://github.com/INTENTIUS/loomster/issues/1). Until it ships, the
script fails each row with an access error and leaves the column untouched,
and lazy migration on use runs into the same missing permission. Run
`migrate_oauth2_secrets.py` without `--apply` first to see how many rows are
affected, and only add `--apply` once #1 is deployed.

### Loom no longer creates IAM roles

v1.9.0 removed Loom's ability to create or modify IAM roles. An agent can't be
deployed without a `role_arn`, and the role has to be registered under
**Security > Roles** and tagged into the agent's group. Upstream's
`DEPLOYMENT.md`:

> If you are upgrading from a version where Loom created roles on demand,
> agents whose role was auto-created will not redeploy until that role is
> registered under **Security > Roles**.

Before upgrading, list the agents whose role Loom created for them, and after
the upgrade register each of those roles in the UI and tag it into the right
group. loomster's backend task role has never had IAM write access, so on a
loomster deployment such roles are unlikely, but check before relying on that.
Integrations (S3, Lambda, DynamoDB and so on) now record configuration only.
The matching IAM statement has to be added to the agent's role stack.

### Permission requests are gone

The permission-requests feature was removed, so the `permission_requests`
table is unused. `drop_permission_requests.py --apply` drops it and destroys
the request history. It's optional; without `--apply` it only reports the row
count.

## Not needed: `fix_sequences.py`

Upstream's `make migrate` runs `fix_sequences.py` after copying a SQLite
database into Postgres with explicit ids. It isn't part of an upgrade, and
`loom-restore` doesn't need it either: RDS snapshot and point-in-time restores
are physical copies, so sequences come back at the values they had. It's in
the image if you ever load data logically, and `LOOM_UPGRADE_SCRIPTS=fix_sequences.py`
runs it.
