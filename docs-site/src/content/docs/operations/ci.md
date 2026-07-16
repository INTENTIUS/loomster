---
title: CI providers
description: Where GitHub, GitLab, and Forgejo each stand for loomster across the generated component pipeline, drift validation, runtime E2E, gated deploy, and scheduled lifecycle, plus what's left to bring each to parity.
---

loomster's component pipeline is generated from the same graph the CLI reads
(`chant build --components --generate <provider>`). One stage per parallel-safe
wave, one job per component, dependency edges mirroring `dependsOn`, and
cross-stack outputs threaded as job artifacts. That generated pipeline can target
GitHub Actions, GitLab CI, or Forgejo Actions.

Around the generated pipeline sit the operational workflows: the gated deploy that
runs `chant run --components all`, and the scheduled lifecycle jobs (watch,
reconcile, cost-report, audit).

All three providers are at parity: each has a committed, drift-validated,
unit-tested, runtime-proven component pipeline plus a gated deploy and scheduled
lifecycle workflows. GitHub is the project's own host, so its operational
workflows are the reference; GitLab and Forgejo carry the same shapes in their
own dialects.

## Support by provider

| Capability | GitHub | GitLab | Forgejo |
|---|---|---|---|
| Generated component pipeline | shipped (`generate:github`) | shipped (`generate:gitlab`) | shipped (`generate:forgejo`) |
| Committed + drift-validated + unit test | shipped (`github-validate`, `github-pipeline.test.ts`) | shipped (`gitlab-validate`, `gitlab-pipeline.test.ts`) | shipped (`forgejo-validate`, `forgejo-pipeline.test.ts`) |
| Runtime E2E against Floci | shipped (`github-runtime-e2e`, via `act`) | shipped (`gitlab-runtime-e2e`) | shipped (`forgejo-runtime-e2e`, via `act`) |
| Gated deploy pipeline | shipped (`deploy.yml`) | shipped (`.gitlab-ci.yml` deploy job) | shipped (`.forgejo/workflows/deploy.yml`) |
| Scheduled lifecycle (watch/reconcile/cost/audit) | shipped (4 workflows) | shipped (schedule-gated jobs) | shipped (4 workflows) |

All three providers are at parity.

## GitHub

GitHub is the project's own host and carries the operational workflows.

- **Gated deploy.** `.github/workflows/deploy.yml` runs `chant run --components all`
  behind an opt-in gate (repo variable `DEPLOY` plus a `production` environment).
- **Gating CI.** `.github/workflows/ci.yml` runs `just check` on every PR.
- **Scheduled lifecycle.** `watch.yml`, `reconcile.yml`, `cost-report.yml`, and
  `audit.yml` run the stateless lifecycle concerns on cron, each inert until a
  repo variable opts it in.
- **Generated component pipeline.** `npm run generate:github` produces the
  committed `.github/workflows/components.yml` with one job per component and
  `needs:` edges, plus artifact upload/download for cross-stack outputs.
- **Drift-validated and tested.** `just github-validate` regenerates and diffs,
  and `src/github-pipeline.test.ts` asserts the committed file matches the live
  component graph (the same drift gate GitLab has).
- **Runtime E2E.** `just github-runtime-e2e` runs the generated workflow in Docker
  via `act` against Floci, deploying the light tier's infrastructure components
  end to end including the cross-stack artifact handoff between jobs. On-demand,
  needs Docker and `act`, not part of gating CI.

## GitLab

GitLab uses a single `.gitlab-ci.yml`, so the generated pipeline and the
operational jobs share one file.

- **Generated + committed.** `npm run generate:gitlab` writes
  `.gitlab/components.yml`. The root `.gitlab-ci.yml` `include`s it (on push/MR,
  and skips it on schedule pipelines).
- **Drift-validated.** `just gitlab-validate` regenerates and diffs, failing on
  drift. `src/gitlab-pipeline.test.ts` asserts the committed copy, the live
  component graph, and the generated stage/job/`needs:` structure all agree.
- **Runtime E2E.** `just gitlab-runtime-e2e` runs the generated pipeline in Docker
  via `gitlab-ci-local` against Floci, deploying the light tier's infrastructure
  components end to end, including the cross-stack output handoff between waves.
  On-demand, needs Docker, not part of gating CI.
- **Gated deploy.** The root `.gitlab-ci.yml` carries a `deploy` job that runs
  `chant run --components all`, inert until the `DEPLOY` variable is set, always a
  manual button, and never on a schedule. Mirrors `deploy.yml`.
- **Scheduled lifecycle.** `watch` / `reconcile` / `cost-report` / `audit` jobs run
  only on schedule pipelines, each inert until its own variable is set (reconcile
  also tier-gated). Mirrors the GitHub crons.

The component pipeline runs on push and is skipped on schedule (a conditional
`include`), so a scheduled lifecycle run never triggers a deploy.

## Forgejo (Codeberg / Gitea)

Forgejo Actions is a GitHub-Actions dialect (`runs-on: docker`, actions resolved
from `code.forgejo.org`).

- **Generated + committed.** `npm run generate:forgejo` writes the committed
  `.forgejo/workflows/components.yml`.
- **Drift-validated and tested.** `just forgejo-validate` regenerates and diffs,
  and `src/forgejo-pipeline.test.ts` asserts the committed file matches the live
  component graph.
- **Runtime E2E.** `just forgejo-runtime-e2e` runs the generated workflow in Docker
  via `act` against Floci (a real `act_runner` runs the same file), deploying the
  light tier's infrastructure components end to end with the cross-stack artifact
  handoff. On-demand, needs Docker and `act`, not part of gating CI.
- **Gated deploy + scheduled lifecycle.** `.forgejo/workflows/deploy.yml` (inert
  until `DEPLOY=true`) plus `watch` / `reconcile` / `cost-report` / `audit`
  workflows, mirroring the GitHub ones.

Two Forgejo-specific notes: image builds in the deploy workflow need a Forgejo
runner with Docker access, and the `reconcile` PR path depends on chant's
ReconcileOp using the Forgejo API. Both mirror how the GitHub deploy/reconcile
workflows behave (inert by default, not yet run against real infrastructure).

## Consuming the output instead

Any team can skip the generated pipeline entirely and deploy from the exportable
bundle (`npm run export-bundle`) with plain `aws cloudformation deploy`, wiring it
into whatever CI they already run. See the README's "Exportable artifact bundle"
section.
