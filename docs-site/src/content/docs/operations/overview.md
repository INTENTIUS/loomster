---
title: Operations
description: The day-2 lifecycle of a running Loom deployment — drift, upgrade, credential rotation, backup, restore, restore drills, teardown — as chant Ops, plus how they're triggered and gated.
---

Deploying Loom is the first day. Running it is every day after. loomster ships the
day-2 lifecycle as [chant Ops](https://intentius.io/chant/guide/ops/) in `ops/`.
Each runs in-process with `chant run <op>`. A gated Op records its gate on chant's
lifecycle ledger (the `chant/lifecycle` branch) and stops until someone approves.

An agent can drive all of these; the [loomster skill](/loomster/getting-started/overview/#drive-it-with-your-agent)
lists them with the guardrails.

## The Ops

| Op | What it does | Gated? |
|---|---|---|
| `loom-watch` | Drift detection — `chant lifecycle diff --live` across every stack, on a 15-min cron. Every tier. | No |
| `loom-reconcile` | On drift, opens a cloud-to-code PR (owned-only, never mutates the cloud). `production` / `production-ha`. | No |
| `loom-upgrade-light` | Snapshot RDS, roll the backend (Loom migrates on startup), roll the frontend. | No |
| `loom-upgrade-production[-ha]` | Same, plus an approval gate, one-time Loom scripts (`LOOM_UPGRADE_SCRIPTS`), and an RDS-restore rollback. | Yes |
| `loom-rotate-production[-ha]` | Rotate the Cognito M2M client, the RDS credential, and (custom-domain tiers) the ALB's ACM cert. | Yes |
| `loom-backup` | Labelled RDS snapshot, plus a cross-region DR copy when `LOOM_DR_REGION` is set. Additive. | No |
| `loom-restore-drill` | Restore the latest backup to a throwaway instance, assert it comes up healthy, delete it. Proves the backup works. | No |
| `loom-cognito-export` | Export the Cognito pool's users, groups, and memberships. Read-only. | No |
| `loom-restore` | Restore the DB (snapshot or PITR) to a new instance, then cut the backend over to it. | Yes — cutover is destructive |
| `loom-teardown` | Gated, owned-only, marker-scoped stack deletes, one per component, in reverse `chant graph --components` order (`loom-agents` first, `shared-foundation` last). No foreign deletes. | Yes |
| `loom-audit` | Security-audit the generated CI YAML. | No |
| `loom-dns-setup` | Create + delegate the Route53 zone for a custom domain, then wait for the delegation to resolve. Human-in-the-loop, local. | No |
| `loom-bootstrap` | Once per account: create the ECS and AgentCore runtime-identity service-linked roles if missing (Loom's `make ecs.init`/`agentcore.init`). Idempotent. | No |
| `loom-import-sqlite`, `loom-fix-sequences`, `loom-reset-db`, `loom-credentials[-delete]`, `loom-memory`, `loom-cognito-set-passwords` | Loom's operator make targets; see [Loom make targets](/loomster/reference/make-targets/). | `import-sqlite`, `reset-db`, `credentials-delete` |

## Running them

```
chant run loom-backup                        # no gate
chant run loom-upgrade-production            # stops at the "Approve" gate, exit 3
chant approve loom-upgrade-production approve-loom-upgrade-production
chant run loom-upgrade-production            # continues past the approved gate
```

The gated Ops (`upgrade-production*`, `rotate*`, `restore`, `teardown`) stop at
their gate with exit 3 and write a pending fact to the ledger. `chant approve`
records the approval as another fact, and the next run reads it and carries on.
Nothing waits in between, so a run that crashed is resumed by running it again.

chant pushes `chant/lifecycle` to `origin` after each write. `just install` adds
a pre-push hook that refuses that branch unless `CI` is set or
`LOOM_LEDGER_PUSH=1`, so a local or Floci run keeps its ledger in the checkout.
Set `LOOM_LEDGER_PUSH=1` when someone else approves your gates from another
clone. If CI has since written to the remote ledger and your local branch has
facts it never pushed, chant refuses to read the diverged ledger; reset the
local branch to the remote one to rejoin it.

## Triggers

An Op is a workflow; how it *fires* is a separate concern. loomster wires three
trigger hosts, and a team can use any mix:

- **On demand** — `chant run <op>`, or the `npm run` alias.
- **Op schedules** — `loom-watch` (drift, every tier) and `loom-reconcile`
  (hourly, production tiers) carry a `schedule` that `chant run --generate`
  renders as a CI cron.
- **CI crons** — inert GitHub Actions workflows a team opts into with a repo
  variable: `backup.yml` (daily, `SCHEDULED_BACKUP`), `restore-drill.yml` (monthly,
  `SCHEDULED_RESTORE_DRILL`), `watch.yml`, `reconcile.yml`, `audit.yml`,
  `cost-report.yml`.

Where a wait has an observable completion condition, an Op polls for it instead
of gating, so it finishes in one run. `loom-dns-setup` does this: it prints the NS records, then polls
public DNS until you've added the delegation at your provider, rather than asking for
a blind approval.

## In depth

- **[Production on real AWS](/loomster/operations/production-live-e2e/)** — the
  real-account runbook: custom-domain delegation, bring-your-own network, the live
  deploy, authenticated validation, teardown.
- **[Upgrade](/loomster/operations/upgrade/)**: bumping the Loom pin, running
  the upgrade Op per tier, how Loom migrates its schema on backend startup, and
  the one-time scripts and manual steps for v1.6 to v1.9.
- **[Backup & restore](/loomster/operations/backup-restore/)** — what holds state,
  what protects it, the restore runbook, the restore drill, and recovery targets per
  tier.
- **[CI providers](/loomster/operations/ci/)** — where GitHub, GitLab, and Forgejo
  each stand for the generated pipeline, drift validation, runtime E2E, gated deploy,
  and scheduled lifecycle.
