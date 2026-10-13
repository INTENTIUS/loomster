---
title: Migrate Loom's database
description: Hand Loom's Postgres schema to SQL Yodeler, record the v1.9.0 baseline on a deployment, and apply each Loom version's reviewed migration behind a plan-bound approval before the backend rolls.
prompt: |
  Read https://intentius.io/loomster/guides/migrate-the-database/ and, for the deployment the person names, run `just db status` and `just db plan` and report what they print.
  For a Loom bump, run `just db-schema`, `just db new loom-<version>`, `just db lint` and `just db-replay`, and open a pull request with db/src and the new migration. Run `just db apply`, `just db baseline` or `just db reader` only if the person asked for it in this session, and leave `just db approve` to them.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

Loom's schema changes become versioned migrations you review in a pull
request. Each deployment's database records which ones it has, applies new
ones only behind an approval bound to the exact plan, and reports any table or
column changed by hand.

Loom has no migration tool of its own. When a backend task starts it runs
SQLAlchemy's `create_all` and a fixed list of `ALTER TABLE ... ADD COLUMN`
statements (`backend/app/db.py`, `init_db`), so on its own a Loom upgrade can
only add, nobody reviews the change, and nothing records it. loomster gives
the schema to [SQL Yodeler](https://intentius.io/sql-yodeler/) instead. The
project is `db/`:

| Path | What it holds |
|---|---|
| `db/src/schema.ts` | Loom's 28 tables and their indexes, as the vendored Loom version creates them |
| `db/migrations/` | the v1.9.0 baseline, then one migration per Loom version |
| `db/ops/migrate.op.ts` | the migrate [Op](/loomster/concepts/glossary/#op): plan, a gate bound to the plan digest, apply |
| `db/ops/watch.op.ts` | the drift watch |
| `db/chant.config.ts`, `db/yodel.config.ts` | one environment per deployment, named like its stacks (`loom-dev-a`) |

`just db <command>` runs yodel there against the deployment your `LOOM_ENV`,
`LOOM_INSTANCE` and `LOOM_PROJECT` name.

## Prerequisites

- A deployed `loom-db` (`chant run --components all`) and the deployment's
  `LOOM_*` variables and AWS credentials.
- On AWS, a way into the private subnets: the tunnel host and the Session
  Manager plugin, as in [Open a tunnel to the database](/loomster/guides/open-a-tunnel-to-the-database/).
  `just db` brings the tunnel up itself for each command, to the RDS instance
  rather than the proxy, because a migration takes a session advisory lock and
  runs DDL, and closes it when the command ends. It connects with SSL, which
  RDS requires; the certificate isn't checked, since the connection reaches
  the database as `127.0.0.1` through the tunnel's authenticated session.
- On the local stack (`just local-up`), nothing more: `just db` forwards a
  loopback port to [Floci](/loomster/concepts/glossary/#floci)'s RDS for the
  length of the command.
- `just db` picks a free local port each time. Set `LOOM_DB_LOCAL_PORT` to use
  a fixed one; a fixed port that is already in use is refused.
- Docker, for `just db-schema` and `just db-replay`.

## Steps

### 1. Create the read-only user

yodel reads with one user and writes with another, and refuses a deployment
where they are the same. The writer is the RDS master user Loom connects as.
The reader is `loom_reader`, whose password `loom-db` generates into its own
secret (`oRdsReaderSecretArn`). Create the user in Postgres once, as the
master user:

```sh
just tunnel-host        # AWS only, once
just db reader
```

It logs in, reads Loom's tables and yodel's history, and every session it
opens is read-only. Running it again resets its password to the secret's and
grants again. With a database you bring (`LOOM_DB_MODE=reference-existing`)
there is no reader secret: create the user yourself and set
`LOOM_DB_READER_USER` and `LOOM_DB_READER_PASSWORD`.

### 2. Record the baseline

A deployment's first backend start already created the v1.9.0 schema. Record
it as the baseline instead of running it:

```sh
just db baseline
```

yodel compares the live schema with the one the baseline declares and refuses,
naming each difference, unless they are the same. Then it stops at the
deployment's gate (exit 3) and prints the approval command. Approve it at your
terminal, then run the same command again:

```sh
just db approve        # shows the plan, asks you to type the deployment's name
just db baseline
```

`just db status` then lists the baseline applied. A brand new, empty database
can take the baseline as a migration instead: `LOOM_DB_APPLY_BASELINE=1 just db apply`.

### 3. Read the deployment

These run as the reader:

```sh
just db status    # applied, pending, out of order; exit 3 when something is pending
just db plan      # what apply would run, statement by statement, and the plan digest
just db drift     # a declared object changed out of band, or gone; exit 2 on drift
just db report    # the migrations and the audit log
```

`just db watch` runs the drift watch Op once and records what it found. To run
it on a schedule, run it from a machine that can reach the database. yodel's
drift compares the tables and columns `db/src` declares, so a column someone
adds by hand to a declared table goes unreported; a changed or dropped one is
reported.

`just db docs --out ../dist/schema-docs` writes an HTML reference of Loom's
schema and a Mermaid ERD, offline.

### 4. Write a Loom version's migration

After moving the pin ([Upgrade Loom](/loomster/guides/upgrade-loom/), step 1)
and `npm run vendor`:

```sh
just db-schema                 # db/src/schema.ts from the new version's own init_db
just db new loom-v1.10.0       # the migration from the declared difference
just db lint
just db-replay
```

`just db-schema` starts a throwaway Postgres 15, runs the vendored Loom's
`init_db` against it exactly as a backend task would, and imports what it
created. `just db new` writes `db/migrations/<timestamp>-loom-v1.10.0/`:
`migration.sql`, the statements, and `migration.json`, the schema they end
at. Read `migration.sql`. It runs before the new backend rolls, while the old
backend still serves, so it must be a change the old code tolerates. yodel's
lint fails a drop or a rewrite (exit 3), and yodel's steps cover what one
statement can't, such as a safe rename or a backfill. Commit `db/src` and the
migration with the pin change. CI's `schema` job lints the migrations and
replays them all into a fresh Postgres.

### 5. Apply it

The upgrade Op's Schema phase runs `just db apply` before it rolls the backend.
Approve the plan first, at your terminal, from a machine that reaches the
database:

```sh
just db plan
just db approve
chant run loom-upgrade-production
```

Without an approval, Schema stops at yodel's gate (exit 3) and prints the
command; approve, then run the Op again. The approval binds the plan digest:
the pending migrations' checksums, the history and the live schema. If any of
them changes before the apply, yodel asks again and applies nothing. An
approval for one deployment never counts for another, since each has its own
gate (`approve-migrate-loom-prod-a`). The new backend's own startup migration
then finds nothing left to do.

## Next

- [Upgrade Loom](/loomster/guides/upgrade-loom/): the whole upgrade, of which this is the Schema phase.
- [Back up and restore](/loomster/guides/back-up-and-restore/): yodel's history lives in the
  database (schema `yodeler`), so a restored snapshot carries the history that
  matches its schema.
- [SQL Yodeler's documentation](https://intentius.io/sql-yodeler/): steps, lint rules, revert and repair.
