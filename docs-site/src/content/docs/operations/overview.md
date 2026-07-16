---
title: Operations
description: The day-2 lifecycle of a running Loom deployment — drift, upgrade, credential rotation, backup, restore, restore drills, teardown — as chant Ops, plus how they're triggered and gated.
---

Deploying Loom is the first day. Running it is every day after. loomster ships the
day-2 lifecycle as [chant Ops](https://intentius.io/chant/guide/ops/) in `ops/` —
durable, resumable workflows that run on [Temporal](https://temporal.io) when they
need an approval gate and saga rollback, or on the local executor when they don't.

An agent can drive all of these; the [loomster skill](/loomster/getting-started/overview/#drive-it-with-your-agent)
lists them with the guardrails.

## The Ops

| Op | What it does | Gated? |
|---|---|---|
| `loom-watch` | Drift detection — `chant lifecycle diff --live` across every stack, on a 15-min cron. Every tier. | No |
| `loom-reconcile` | On drift, opens a cloud-to-code PR (owned-only, never mutates the cloud). `production` / `production-ha`. | No |
| `loom-upgrade-light` | Snapshot RDS, migrate, promote-by-digest. | No — local executor |
| `loom-upgrade-production[-ha]` | Same, plus an approval gate and an RDS-restore rollback. | Yes |
| `loom-rotate-production[-ha]` | Rotate the Cognito M2M client, the RDS credential, and (custom-domain tiers) the ALB's ACM cert. | Yes |
| `loom-backup` | Labelled RDS snapshot, plus a cross-region DR copy when `LOOM_DR_REGION` is set. Additive. | No — local executor |
| `loom-restore-drill` | Restore the latest backup to a throwaway instance, assert it comes up healthy, delete it. Proves the backup works. | No — local executor |
| `loom-cognito-export` | Export the Cognito pool's users, groups, and memberships. Read-only. | No — local executor |
| `loom-restore` | Restore the DB (snapshot or PITR) to a new instance, then cut the backend over to it. | Yes — cutover is destructive |
| `loom-teardown` | Gated, owned-only, marker-scoped stack deletes. No foreign deletes. | Yes |
| `loom-audit` | Security-audit the generated CI YAML. | No |

## Running them

```
chant run loom-backup                        # local executor, no Temporal needed
chant run loom-upgrade-production --temporal # pauses at the "Approve" gate
chant run signal loom-upgrade-production approve-loom-upgrade-production
```

The gated Ops (`upgrade-production*`, `rotate*`, `restore`, `teardown`) run on
Temporal so the approval and the rollback are durable. The ungated Ops run on the
local executor with nothing extra to stand up.

## Triggers

An Op is a workflow; how it *fires* is a separate concern. loomster wires three
trigger hosts, and a team can use any mix:

- **On demand** — `chant run <op>`, or the `npm run` alias.
- **Temporal schedules** — `loom-watch` (drift, every tier) and `loom-reconcile`
  (hourly, production tiers) emit a `TemporalSchedule` from `chant build ops`.
- **CI crons** — inert GitHub Actions workflows a team opts into with a repo
  variable: `backup.yml` (daily, `SCHEDULED_BACKUP`), `restore-drill.yml` (monthly,
  `SCHEDULED_RESTORE_DRILL`), `watch.yml`, `reconcile.yml`, `audit.yml`,
  `cost-report.yml`. CI-cron is one trigger host among several — run it instead of,
  or alongside, a Temporal schedule.

## In depth

- **[Backup & restore](/loomster/operations/backup-restore/)** — what holds state,
  what protects it, the restore runbook, the restore drill, and recovery targets per
  tier.
- **[CI providers](/loomster/operations/ci/)** — where GitHub, GitLab, and Forgejo
  each stand for the generated pipeline, drift validation, runtime E2E, gated deploy,
  and scheduled lifecycle.
