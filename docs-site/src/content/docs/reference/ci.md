---
title: CI providers
description: The generated component pipeline and the deploy and scheduled workflows on GitHub, GitLab and Forgejo, what each file is, how it is checked, and the variables that turn each workflow on.
---

The component pipeline is generated from the same graph `chant graph --components`
prints: one stage per [wave](/loomster/concepts/glossary/#wave), one job per
component, dependency edges from `dependsOn`, and each stack's outputs handed to
the next job as artifacts. Around it sit a gated deploy and the scheduled
[Ops](/loomster/reference/ops/).

## By provider

| | GitHub | GitLab | Forgejo |
|---|---|---|---|
| Generated component pipeline | `.github/workflows/components.yml` (`npm run generate:github`) | `.gitlab/components.yml` (`npm run generate:gitlab`), included by `.gitlab-ci.yml` on push and merge requests | `.forgejo/workflows/components.yml` (`npm run generate:forgejo`) |
| Drift check of the committed file | `src/github-pipeline.test.ts` | `src/gitlab-pipeline.test.ts` | `src/forgejo-pipeline.test.ts` |
| Run against [Floci](/loomster/concepts/glossary/#floci) | `just github-runtime-e2e` (with `act`) | `just gitlab-runtime-e2e` (with `gitlab-ci-local`) | `just forgejo-runtime-e2e` (with `act`) |
| Gated deploy | `.github/workflows/deploy.yml` | the `deploy` job in `.gitlab-ci.yml`, a manual button, never on a schedule | `.forgejo/workflows/deploy.yml` |
| Scheduled Ops | five workflows (below) | schedule-only jobs in `.gitlab-ci.yml` | workflows mirroring GitHub's |

The drift checks are part of `npm test`, so a committed pipeline that differs
from a fresh generate fails CI. The Floci runs deploy the light
[tier](/loomster/concepts/tiers-and-instances/)'s infrastructure components with
the output handoff between waves; they need Docker and aren't part of the
gating CI.

On GitLab the component pipeline is skipped on schedule pipelines, so a
scheduled Op never triggers a deploy. A Forgejo deploy needs a runner with
Docker access for the image builds, and Forgejo's reconcile opens its pull
request through the Forgejo API.

## The repository's own CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`:
typecheck, `chant lint .`, the unit tests and the Ops build. It needs no
credentials.

## Generated jobs and their runner

Each generated job is a thin trigger, `chant run --components <name>`, and
assumes [chant](/loomster/concepts/glossary/#chant), its dependencies and the AWS CLI are on the runner. Each
component's first phase synthesizes its own template from the job's `LOOM_*`
variables, so there is no separate synth job. Provide the rest once, through
`generateComponentPipeline`'s `beforeScript`, `image` or `extraScript`: a runner
image with chant and the AWS CLI installed, or `npm ci` plus an AWS CLI install
on a stock image.

## Deploy workflow

`deploy.yml` runs `chant run --components all --env "$LOOM_ENV"`. It stays
inert until you set:

1. the repository variable `DEPLOY` to `true`;
2. a GitHub environment named `production` holding the AWS credentials the job
   uses.

## Scheduled workflows

| Workflow | Runs | Cron | Turned on by | Also needs |
|---|---|---|---|---|
| `watch.yml` | `loom-watch` | every 15 minutes | `SCHEDULED_WATCH=true` | the `production` environment |
| `reconcile.yml` | `loom-reconcile` | hourly | `SCHEDULED_RECONCILE=true` and `LOOM_TIER` set to a production tier | the `production` environment |
| `backup.yml` | `loom-backup` | daily | `SCHEDULED_BACKUP=true` | the `production` environment; `LOOM_DR_REGION` and `LOOM_DR_KMS_KEY_ID` for a DR copy |
| `restore-drill.yml` | `loom-restore-drill` | monthly | `SCHEDULED_RESTORE_DRILL=true` | the `production` environment |
| `cost-report.yml` | `npm run synth && npm run estimate-cost` | weekly | `SCHEDULED_COST_REPORT=true` | `infracost` and an `INFRACOST_CLI_AUTHENTICATION_TOKEN` secret for real numbers |
| `audit.yml` | `loom-audit` | daily | `SCHEDULED_AUDIT=true` | nothing |

Every one also has `workflow_dispatch` for an on-demand run. The gated Ops are
never scheduled.

## Using your own CI

Skip the generated pipeline and deploy the synthesized templates with
`aws cloudformation deploy` from whatever CI you run
([Deploy without chant](/loomster/guides/deploy-without-chant/)).
