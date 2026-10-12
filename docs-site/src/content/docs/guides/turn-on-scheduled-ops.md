---
title: Turn on scheduled Ops
description: Turn on the inert GitHub Actions workflows that run drift watch, reconcile, backup, the restore drill, the cost report and the CI audit on a schedule.
prompt: |
  Read https://intentius.io/loomster/guides/turn-on-scheduled-ops/ and list, for the person's repository, which scheduled workflows are on (`gh variable list`) and what each still needs.
  Don't set variables, environments or secrets; tell the person the commands.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

The ungated [Ops](/loomster/reference/ops/) running on cron in GitHub Actions.
The gated ones (upgrade, rotation, restore, teardown) are never scheduled; a
person runs and approves them.

## Prerequisites

The repository on GitHub, and for the workflows that touch AWS a GitHub
environment named `production` with the account's credentials (the same one
`deploy.yml` uses).

## Steps

1. Pick the workflows and set their variables:

   | Workflow | Runs | Cron | Set | Also needs |
   |---|---|---|---|---|
   | `watch.yml` | `loom-watch` | every 15 minutes | `SCHEDULED_WATCH=true` | `production` environment |
   | `reconcile.yml` | `loom-reconcile` | hourly | `SCHEDULED_RECONCILE=true`, and `LOOM_TIER` set to a production [tier](/loomster/concepts/glossary/#tier) | `production` environment |
   | `backup.yml` | `loom-backup` | daily | `SCHEDULED_BACKUP=true` | `production` environment; `LOOM_DR_REGION`, `LOOM_DR_KMS_KEY_ID` for a DR copy |
   | `restore-drill.yml` | `loom-restore-drill` | monthly | `SCHEDULED_RESTORE_DRILL=true` | `production` environment |
   | `cost-report.yml` | synth and `estimate-cost` | weekly | `SCHEDULED_COST_REPORT=true` | `infracost` and an `INFRACOST_CLI_AUTHENTICATION_TOKEN` secret for real numbers |
   | `audit.yml` | `loom-audit` | daily | `SCHEDULED_AUDIT=true` | nothing |

   For example:

   ```
   gh variable set SCHEDULED_BACKUP --body true
   gh variable set LOOM_TIER --body production
   gh variable set LOOM_ENV --body prod
   ```

   The workflows read `LOOM_ENV` and `LOOM_TIER` repository variables for the
   deployment they act on (`dev` and `light` when unset).

2. Run one by hand to check it: every workflow has `workflow_dispatch`, so
   `gh workflow run backup.yml` starts it now.

`reconcile.yml` opens pull requests with the default `GITHUB_TOKEN`; its
`contents: write` and `pull-requests: write` permissions are already declared.
`watch.yml` and `reconcile.yml` write their run records to the `chant/lifecycle`
branch, which CI pushes ([Gated Ops](/loomster/concepts/gated-ops/#keeping-the-ledger-local)).
On GitLab the same Ops run as schedule-only jobs in `.gitlab-ci.yml`, each behind
its own variable.

## Next

[Watch and reconcile drift](/loomster/guides/watch-and-reconcile-drift/) and
[Back up and restore](/loomster/guides/back-up-and-restore/).
