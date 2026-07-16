# loomster

Typed, tiered infrastructure-as-code for
[awslabs/loom](https://github.com/awslabs/loom) on
[chant](https://intentius.io/chant). Six components, three tiers
(`light` / `production` / `production-ha`), generated CI, and a naming scheme
that lets many Loom instances coexist in one or many AWS accounts without
collision. Pinned to Loom `v1.6.0`.

Loom's own deploy today is a manual, multi-step SAM process behind a
`DEPLOYMENT.md`. chant types it, lints it, dedupes the cross-stack glue, orders
it, tiers it, and generates the pipeline.

**Docs:** [Tutorial](https://intentius.io/loomster/getting-started/tutorial/) ·
[Overview](https://intentius.io/loomster/getting-started/overview/) ·
[Adoption](https://intentius.io/loomster/guides/adoption/) ·
[Run it locally](https://intentius.io/loomster/guides/local/) ·
[Naming](https://intentius.io/loomster/reference/naming/)

## Where it runs today

- The full stack builds Loom's real images and runs on [Floci](https://floci.io),
  a local emulator, browsable at `localhost:8080`, no AWS account.
- The **light tier is deployed end to end to a real AWS account**. Loom served on
  a real ALB, backed by real RDS and Cognito.
- `production` / `production-ha` synthesize and pass the fidelity audit against
  Loom's `v1.6.0` templates, but haven't been applied to a live account yet.

## Run it locally

```
just local-up     # browsable, authenticated Loom (needs Docker, no AWS account)
just local-down   # tear it down
```

Floci provides the managed pieces (RDS, Cognito, S3, ECR); the app tier runs from
a chant-generated `docker-compose`, browsable at `http://localhost:8080`. The web
app runs for real; only agents can't run locally (Bedrock AgentCore has no local
emulator). See the [local guide](https://intentius.io/loomster/guides/local/) and
[local caveats](https://intentius.io/loomster/reference/local-caveats/).

## Develop

`package.json` consumes published `@intentius/chant` and its lexicons from npm. No sibling checkout, no codegen step. A fresh clone installs and builds on its
own, which is what CI does.

```
just install   # npm install
just build     # typecheck (helper, composites, project-local lint rules)
just lint      # chant lint . — core rules + .chant/rules/ project-local rules
just test      # vitest run
just check     # all of the above
```

## Components

Six stacks, deployed in dependency order (`chant graph --components`):

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | — | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role |
| `loom-cognito` | — | Cognito user pool, hosted-UI domain, resource server, clients |
| `loom-db` | `shared-foundation` | RDS Postgres, Secrets Manager; production adds RDS Proxy + rotation |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service |
| `loom-agents` | `shared-foundation`, `loom-cognito`, `loom-backend` | The Bedrock AgentCore agents — one Strands agent (every tier) + a no-code harness agent (production-ha) |

`loom-backend` / `loom-frontend` each run **build, publish, apply, verify**:
`docker-build`, then `publish-image` promoted by digest, then `cfn-deploy`, then
(against real AWS only) `wait-steady-state` and `health-gate`, with a
`rollback-previous` compensation phase. The runtime Verify checks are skipped
against Floci, which takes every stack to `CREATE_COMPLETE` but does not run the
app workload. Cross-stack inputs (cluster ARN, security group, target group, the
DB secret, the Cognito pool, and more) resolve via `stackOutput(...)`.

`downstream-stub` in the graph is a verification-only stack, not part of Loom. It
consumes `shared-foundation`'s outputs to prove they resolve for a real consumer.

## Deploy

Deployment is via **GitHub Actions** (`.github/workflows/deploy.yml`), **gated**
so it stays inert until you opt in:

1. Repo **variable** `DEPLOY` = `true`.
2. A GitHub **environment** named `production` holding the AWS credentials the job
   assumes.

The job vendors Loom's source, configures AWS credentials + ECR login, and runs
`chant run --components all --env "$LOOM_ENV"`, the dependency-ordered
orchestrator. It derives the wave order from each component's `dependsOn`, builds
and publishes the images by digest, and applies each stack. See the
[Tutorial](https://intentius.io/loomster/getting-started/tutorial/) for the
tier-by-tier walkthrough.

## Docker build context

`loom-backend` / `loom-frontend` build Loom's actual images, but Loom's source
isn't vendored into this repo. It lives upstream at
[`awslabs/loom`](https://github.com/awslabs/loom), pinned `v1.6.0`. Fetch it
before a real `chant run` deploy or a manual `docker build`:

```
npm run vendor   # or: just vendor
```

`scripts/vendor-loom.sh` resolves `refs/tags/v1.6.0`, checks it against a sha
pinned in the script (a tag is mutable, so this fails loudly if it's ever
force-moved), then sparse-checks out just `backend/`, `frontend/`, and `agents/`
into `vendor/loom` (gitignored).

Not required for typecheck/test/synth, which never touch `vendor/loom`. **Run it
right before a deploy, not before `chant lint .`**. Unlike `tsc`, a whole-project
`chant lint`/`build` walks every `.ts` under the path with no gitignore
awareness, so a present `vendor/loom` gets linted as project code. CI never
vendors, so the gating `lint` job is unaffected; locally, `rm -rf vendor/loom`
before `just check` if you've vendored.

The build contexts, for reference:

| Component | `context` | `dockerfile` |
|---|---|---|
| `loom-backend` | `vendor/loom` | `backend/Dockerfile` |
| `loom-frontend` | `vendor/loom/frontend` | `Dockerfile` (default) |

`loom-backend`'s context is the vendor root (not `vendor/loom/backend`) because
its `Dockerfile` `COPY`s the Strands agent's source from outside `backend/`, the same context/Dockerfile pair Loom's own `shared/makefile` uses.
`loom-agents` has no `docker-build` phase: `agents/strands_agent/` ships no
Dockerfile upstream. Loom builds that agent as a Python zip and deploys it to
Bedrock AgentCore Runtime, never as a container image.

## Lifecycle Ops

Beyond the one-shot component deploys, `ops/` holds the durable, gated concerns
for a running Loom deployment (upgrade, credential rotation, teardown), plus a
scheduled observe/reconcile pair. These run as
[chant Ops](https://intentius.io/chant/guide/ops/) on
[Temporal](https://temporal.io) where they need an approval gate and saga
rollback, or on the local executor where they don't.

| Op | What it does | Gated? |
|---|---|---|
| `loom-watch` | Drift detection — `chant lifecycle diff --live` across every stack, on a 15-min cron. Every tier. | No |
| `loom-reconcile` | On drift, opens a cloud-to-code PR (owned-only, never mutates the cloud). `production` / `production-ha`. | No |
| `loom-upgrade-light` | Snapshot RDS, migrate, promote-by-digest. | No — local executor |
| `loom-upgrade-production[-ha]` | Same, plus an approval gate and an RDS-restore rollback. | Yes |
| `loom-rotate-production[-ha]` | Rotate the Cognito M2M client, the RDS credential, and (custom-domain tiers) the ALB's ACM cert. | Yes |
| `loom-backup` | Labelled RDS snapshot, plus a cross-region DR copy when `LOOM_DR_REGION` is set. Additive. | No — local executor |
| `loom-cognito-export` | Export the Cognito pool's users, groups, and memberships (to stdout, or S3 with `LOOM_BACKUP_BUCKET`). Read-only. | No — local executor |
| `loom-restore` | Restore the DB (snapshot or PITR) to a new instance, then cut the backend over to it (repoint secret + redeploy). | Yes — cutover is destructive |
| `loom-teardown` | Gated, owned-only, marker-scoped stack deletes. No foreign deletes. | Yes |

```
chant build ops                              # compile to dist/ops/<name>/
chant run loom-upgrade-light                 # local executor, no Temporal needed
chant run loom-upgrade-production --temporal # pauses at "Approve"
chant run signal loom-upgrade-production approve-loom-upgrade-production
npm run watch                                # one-shot loom-watch
npm run reconcile                            # one-shot loom-reconcile
```

Migrations run against the backend's own task-definition family with an
overridden command. No rebuild. The migration entrypoint depends on Loom's own
tooling (known once `vendor/loom` is checked out); override it via
`LOOM_MIGRATION_COMMAND` (comma-separated argv).

## Generated CI

`chant build --components --generate gitlab` synthesizes the component pipeline
from the same component graph `chant graph --components` reads. One stage per
parallel-safe wave, one job per component, `needs:` mirroring `dependsOn`,
cross-stack outputs threaded as job artifacts. It's written to
`.gitlab/components.yml`; the root `.gitlab-ci.yml` `include`s it and adds a gated
`deploy` job and the scheduled lifecycle jobs (the component pipeline is skipped
on schedule pipelines, so a scheduled run never triggers a deploy).

```
npm run generate:gitlab   # writes .gitlab/components.yml
just gitlab-validate      # regenerate + diff against the committed copy (fails on drift)
```

GitHub gets the same treatment via `npm run generate:github` (committed
`.github/workflows/components.yml`, `just github-validate`, `just
github-runtime-e2e` via `act`). See
[CI providers](https://intentius.io/loomster/guides/ci/) for how GitHub, GitLab,
and Forgejo compare.

Every generated job is a thin trigger (`chant run --components <name>`) that
assumes `chant`, its deps, and `dist/*.template.json` already exist. Neither is
true in a bare checkout. Wire it once, project-wide, through
`generateComponentPipeline`'s `beforeScript`/`image`/`extraScript` options: a
custom runner image with `chant` + `awscli` preinstalled, or `beforeScript:
["npm ci", "npm run synth"]` plus an `awscli` install on a stock image.

`just gitlab-runtime-e2e` proves the generated pipeline actually executes. It
runs the generated component pipeline in Docker (via `gitlab-ci-local`) against
Floci, deploying the light tier's infrastructure components end to end including
the cross-stack output handoff between waves. Needs Docker; not part of gating CI.
The GitHub equivalent is `just github-runtime-e2e` (via `act`).

## Scheduled CI

The stateless lifecycle concerns also run on plain GitHub Actions cron, a second
trigger host alongside each Op's own Temporal schedule. The durable/gated Ops
(upgrade, rotation, teardown) are never scheduled here; they need a durable gate a
cron can't give. Each workflow stays inert until a team opts in.

| Workflow | Runs | Cron | Opt-in |
|---|---|---|---|
| `watch.yml` | `loom-watch` | every 15 min | `vars.SCHEDULED_WATCH == 'true'` |
| `reconcile.yml` | `loom-reconcile` | hourly | `vars.SCHEDULED_RECONCILE == 'true'` **and** `vars.LOOM_TIER` is `production`/`production-ha` |
| `cost-report.yml` | `npm run synth && npm run estimate-cost` | weekly | `vars.SCHEDULED_COST_REPORT == 'true'` |
| `audit.yml` | `loom-audit` | daily | `vars.SCHEDULED_AUDIT == 'true'` |
| `backup.yml` | `loom-backup` | daily | `vars.SCHEDULED_BACKUP == 'true'` |

All four also declare `workflow_dispatch` for an on-demand run.
`watch.yml`/`reconcile.yml` additionally need the `production` environment (they
run a live `chant lifecycle diff`); `cost-report.yml`/`audit.yml` never touch AWS.
`reconcile.yml` opens PRs via the default `GITHUB_TOKEN` (with `contents: write`
+ `pull-requests: write`, already declared). `cost-report.yml`'s real numbers need
`infracost` installed plus an `INFRACOST_CLI_AUTHENTICATION_TOKEN` secret; without
them it prints a per-component skip and never fails.

## Exportable artifact bundle

A third adoption on-ramp beyond "run chant" and "adopt this repo": **consume the
output, skip the tool.** Grab the pre-synthesized CloudFormation templates +
generated CI and deploy with plain `aws cloudformation deploy`. chant need not be
installed at deploy time.

```
npm run export-bundle
```

writes `dist/bundle/loom-v1.6.0/{light,production,production-ha}/`. Each tier a
self-contained directory: a synthesized CloudFormation template per component
(`templates/`), the generated GitHub Actions + GitLab CI pipelines (`ci/`), and
the tier's own `manifest.json`. The bundle's generated `README.md` has the deploy
order and the full parameter reference, regenerated from each run's own templates.

## Naming & tagging

Every composite derives its physical resource names and cost tags from one shared
parameter source, `loomNaming(...)` in `src/lib/naming.ts`, keyed
`{project}-{env}-{instance}-{component}-{resource}`. A project-local lint rule
(`.chant/rules/no-hardcoded-name.ts`) flags any hardcoded physical name. Every
taggable resource carries the same five keys (`component` / `tier` / `env` /
`owner` / `instance`) straight from `loomNaming(...).tags()`. See
[Naming & tagging](https://intentius.io/loomster/reference/naming/) for the full
convention.

## Adoption

Every composite exposes a `provision | reference-existing | omit` choice where
meaningful. Bring your own VPC, KMS key, ACM cert, Route53 zone, ECR repos, agent
IAM role, Postgres endpoint, or Cognito pool (including one pool shared across
instances), all through parameters, no composite forked. `src/examples/byo/`
deploys against pre-existing everything with zero composite edits. See
[Adoption](https://intentius.io/loomster/guides/adoption/) for the full matrix.

## Cost estimate (optional)

`npm run estimate-cost` shells out to [Infracost](https://www.infracost.io)
against the synthesized templates, one estimate per component. chant carries no
pricing data. This is plumbing. Without `infracost` installed and authenticated
it prints a per-component skip and exits `0`, never failing the build. Loom's own
per-invocation LLM token cost is application runtime, out of scope for this hook.
