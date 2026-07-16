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

The three providers are not at the same level of support today. GitHub is the
project's host and carries the operational workflows. GitLab has the most mature
generated-pipeline tooling. Forgejo is not wired up yet. This page says exactly
where each stands and what closing the gap takes.

## Where each provider stands

| Capability | GitHub | GitLab | Forgejo |
|---|---|---|---|
| Generated component pipeline | shipped (`generate:github`) | shipped (`generate:gitlab`) | planned (needs a chant generator) |
| Committed + drift-validated + unit test | shipped (`github-validate`, `github-pipeline.test.ts`) | shipped (`gitlab-validate`, `gitlab-pipeline.test.ts`) | planned |
| Runtime E2E against Floci | shipped (`github-runtime-e2e`, via `act`) | shipped (`gitlab-runtime-e2e`) | planned |
| Gated deploy pipeline | shipped (`deploy.yml`) | planned | planned |
| Scheduled lifecycle (watch/reconcile/cost/audit) | shipped (4 workflows) | planned | planned |

The roadmap that closes every "planned" cell is tracked in
`INTENTIUS/loomster#71`.

## GitHub

GitHub is the live host, and it carries the operational surface.

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

GitHub now has the full generated-pipeline lifecycle, matching GitLab, on top of
the deploy and scheduled workflows it already carried.

## GitLab

GitLab has the most mature generated-pipeline lifecycle.

- **Generated + committed.** `npm run generate:gitlab` writes `.gitlab-ci.yml`,
  which is committed to the repo root.
- **Drift-validated.** `just gitlab-validate` regenerates and diffs, failing on
  drift. `src/gitlab-pipeline.test.ts` asserts the committed copy, the live
  component graph, and the generated stage/job/`needs:` structure all agree.
- **Runtime E2E.** `just gitlab-runtime-e2e` runs the real `.gitlab-ci.yml` in
  Docker via `gitlab-ci-local` against Floci, deploying the light tier's
  infrastructure components end to end, including the cross-stack output handoff
  between waves. On-demand, needs Docker, not part of gating CI.

What's missing for parity with GitHub's operational surface: there is no gated
GitLab deploy pipeline and no scheduled lifecycle pipelines. Closing that means a
committed, inert-by-default deploy job (`when: manual` on a protected branch,
credentials from masked CI/CD variables) that runs the same
`chant run --components all`, and GitLab pipeline schedules for the four lifecycle
concerns with the same opt-in gating the GitHub crons use.

## Forgejo (Codeberg / Gitea)

Forgejo is **not supported yet**. There is no `.forgejo/` directory, no
`generate:forgejo` script, and the repo does not depend on the Forgejo lexicon.

The blocker is one level down, in chant: the Forgejo lexicon does not yet
implement `generateComponentPipeline`, so `chant build --components --generate
forgejo` has nothing to call. That's tracked as a chant-side dependency
(`INTENTIUS/chant#969`). Forgejo Actions is a GitHub-Actions dialect, so the
generator can largely reuse the GitHub one with a different output path
(`.forgejo/workflows/`).

Once that lands, Forgejo reaches parity the same way the others do: a committed,
drift-validated, unit-tested generated pipeline; a `forgejo-runtime-e2e` that runs
it via `forgejo-runner` / `act_runner` / `act` against Floci (chant already has
this pattern); a gated deploy workflow; and scheduled lifecycle workflows using
Forgejo Actions cron.

## Consuming the output instead

Any team can skip the generated pipeline entirely and deploy from the exportable
bundle (`npm run export-bundle`) with plain `aws cloudformation deploy`, wiring it
into whatever CI they already run. See the README's "Exportable artifact bundle"
section.
