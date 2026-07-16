# loom-on-chant

Typed, tiered infrastructure-as-code for [awslabs/loom](https://github.com/awslabs/loom)
on [chant](https://intentius.io/chant) — component-based, tiered
(`light` / `production` / `production-ha`), with generated CI and a
parameterization/naming scheme that lets multiple Loom instances coexist in
one or many AWS accounts without collision.

Loom's own deploy today is a manual multi-step SAM process behind a
`DEPLOYMENT.md`; chant types it, lints it, dedupes the cross-stack glue,
orders it, tiers it, and generates the pipeline.

**What's proven today:** the full six-component stack builds Loom `v1.6.0`'s
real backend/frontend/agent images and deploys end to end on a local emulator
([Floci](https://floci.io), light tier) — 7/7 stacks `CREATE_COMPLETE`. The
synthesized CloudFormation has been fidelity-audited against Loom's own
`v1.6.0` templates (resources, params, outputs, container env) and matches.
**Not yet proven:** a real-AWS end-to-end run. The `production` / `production-ha`
tiers synthesize and pass the fidelity audit but have not been deployed against
a live account yet. So this is the path toward a production Loom deployment, not
a production deployment a team has run for real — see [Status](#status) below.

Pinned to **Loom `v1.6.0`** (a moving `as-is` AWS Labs sample — breaking
changes expected upstream between versions).

Tracking: `INTENTIUS/chant#885` (epic) and its child issues.

**Start here:** [`docs/tutorial.md`](docs/tutorial.md) walks a team through
light tier on Floci (no AWS account), production/production-ha on real AWS
behind a gated apply, tier/topology selection, the adoption seams, the
lifecycle Ops, and an honest positioning section (real wins vs. what's
parity with Loom's own SAM deploy, not a win). Everything below is
reference detail the tutorial links back into.

## Repo shape

Standalone repo, modeled on `INTENTIUS/blacklight` — own `package.json`,
`justfile`, `tsconfig.json`, and `.github/workflows/`. It is deliberately
**not** an in-tree `chant` `examples/` dir: an example reads as a demo and
resolves unpublished workspace versions, whereas this must be
production-adoptable and track chant on its own release cadence.

### chant dependency: published npm packages

`package.json` consumes published chant packages — `@intentius/chant`,
`@intentius/chant-lexicon-{aws,temporal,gitlab,github}` at a version range
(currently `^0.18.17`). `npm install` resolves everything from the npm
registry; no sibling `chant` checkout, no codegen step, no `file:` links. A
fresh clone installs and builds on its own, which is exactly what CI does on
every run.

To move to a newer chant, bump the range in `package.json` and re-run the
gate (`just check`).

## Develop

```
just install   # npm install (published @intentius/chant* from npm)
just build     # typecheck (helper, composites, project-local lint rules)
just lint      # chant lint . — core rules + .chant/rules/ project-local rules
just test      # vitest run
just check     # all of the above
```

## Run it locally

```
just local-up     # browsable, authenticated Loom on a laptop (needs Docker, no AWS account)
just local-down   # tear it down
```

Floci provides the AWS-managed pieces (RDS/Cognito/S3/ECR) via chant; the app
tier runs from a chant-generated `docker-compose`, browsable at
`http://localhost:8080`. The web app runs for real (Postgres, API, admin
`local-dev` user); only agents can't run locally (Bedrock AgentCore has no Floci
emulation). See the [Run Loom on your laptop](https://intentius.io/loomster/guides/local/)
guide and the [Local caveats](https://intentius.io/loomster/reference/local-caveats/).

## Naming & tagging

Every composite derives its physical resource names and cost-allocation tags
from one shared parameter source — see [`docs/naming.md`](docs/naming.md) for
the convention (segment order, per-service length/char limits, uniqueness
strategy) and [`src/lib/naming.ts`](src/lib/naming.ts) for the helper itself.
A project-local lint rule (`.chant/rules/no-hardcoded-name.ts`) flags a
hardcoded physical name in a composite.

Every taggable resource across all six composites carries the same five
keys, straight from `loomNaming(...).tags()` — no per-composite copy
(`loom-agents`'s `Runtime`/`RuntimeEndpoint`/`Memory`/`Gateway`/`GatewayTarget`/
`WorkloadIdentity` are the one exception: chant#882's `AgentCoreAgent`
composite doesn't tag those AgentCore-native resources today, only the two
IAM roles it creates — see `src/composites/loom-agents.ts`'s own comment):

| Key | Source | Example |
|---|---|---|
| `component` | the composite's own name | `loom-db` |
| `tier` | `naming.tier` | `production-ha` |
| `env` | `naming.env` | `prod` |
| `owner` | `naming.owner` | `platform` |
| `instance` | `naming.instance` | `a` |

`loom-cognito`'s `UserPool` additionally carries three ABAC tags
(`loom:application`/`loom:group`/`loom:owner`) used for resource-scoped
access control (chant#888) — a different mechanism from the cost-allocation
keys above, on the same resource.

## Cost estimate (optional)

The tags above tell you whose spend a resource is; they don't say how much.
[`scripts/estimate-cost.sh`](scripts/estimate-cost.sh) is an opt-in hook
that shells out to [Infracost](https://www.infracost.io) against the
already-synthesized templates in `dist/` and relays a per-component monthly
estimate. chant carries no pricing data or pricing logic of its own — this
script is plumbing, nothing more.

```
npm run synth          # produce dist/*.template.json
npm run estimate-cost  # per-component Infracost estimate (or `just estimate-cost`)
```

No hard dependency: if `infracost` isn't installed, isn't authenticated, or
can't price a given template, the script prints a notice per component and
exits `0` — it never fails the build or CI. Where Infracost does succeed,
its raw JSON output lands in `dist/cost-estimates/<component>.json`.

**CloudFormation caveat.** As of this writing, Infracost's CloudFormation
support is Cloud-first — CLI/IDE support for CloudFormation templates is on
Infracost's own 2026 roadmap ([announcement](https://www.infracost.io/blog/cloudformation-support-is-here/)).
Until that ships, a real `infracost` install may report no supported files
for these templates; the script treats that the same as "not installed" — a
skip per component, not a build failure. Once CLI support lands, this hook
starts producing real numbers with no changes needed here.

**Not covered:** Loom's own per-invocation LLM token cost (Bedrock/AgentCore
inference spend) is application runtime, not infrastructure — out of scope
for chant and this hook entirely.

## Adoption

Every composite exposes a `provision | reference-existing | omit` choice
where meaningful — bring your own VPC, KMS key, ACM cert, Route53 zone, ECR
repos, agent IAM role, RDS/Postgres endpoint, or Cognito pool (including one
pool shared across multiple Loom instances), all through parameters, no
composite forked. See [`docs/adoption.md`](docs/adoption.md) for the full
matrix (every seam, its default, what replacing it requires) and
[`src/examples/byo/`](src/examples/byo/) for a runnable example that
deploys against a pre-existing VPC, pre-existing IAM roles, and a shared
existing Cognito pool with zero composite source edits.

## Components

Six stacks, deployed in dependency order (`chant graph --components`):

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | — | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role (`#886`) |
| `loom-cognito` | — | Cognito UserPool, hosted-UI domain, resource server, clients (`#888`) |
| `loom-db` | `shared-foundation` | RDS Postgres, Secrets Manager, (full tier) RDS Proxy + rotation (`#887`) |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service (`#889`) |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service (`#889`) |
| `loom-agents` | `shared-foundation`, `loom-cognito`, `loom-backend` | The Bedrock AgentCore agent set — a low-code Strands agent (every tier) + a no-code AgentCore-harness agent (production/production-ha), via chant#882's `AgentCoreAgent` composite (`#893`) |

`loom-backend`/`loom-frontend` each run **build → publish → apply → verify**
(`docker-build` → `publish-image` promoted by digest → `cfn-deploy`, then —
against real AWS only — `wait-steady-state` + `health-gate`), with a
`rollback-previous` compensation phase. The runtime Verify checks are skipped
against a local emulator (Floci), which provisions the control plane and takes
every stack to `CREATE_COMPLETE` but does not run the app workload — the
backend task needs a reachable RDS/Cognito to start, and the ALB does not serve
the ALB→ECS HTTP data path (see the component docstrings). No standalone
`ecs-update-service` step: `cfn-deploy` already rolls the image out via a new
`TaskDefinition` revision. Cross-stack inputs (cluster ARN,
security group, target group, the DB connection secret, the Cognito user
pool, ...) resolve via `stackOutput(...)` — see
`src/components/loom-backend.component.ts`'s docstring for the two spots
where the shipped `EcsFargateComponent` preset's fixed-key conveniences
(`sharedAlbStack`, `imageRef`) don't fit Loom's real parameter names, and how
that's covered instead.

**Docker build context.** `loom-backend`/`loom-frontend` build Loom's actual
application images, but Loom's source (the `backend/`/`frontend/`
directories + their Dockerfiles) is not vendored into this repo — it lives
upstream at [`awslabs/loom`](https://github.com/awslabs/loom) (pinned
`v1.6.0`). Fetch it before running a real `chant run` deploy:

```
npm run vendor   # or: bash scripts/vendor-loom.sh, or: just vendor
```

[`scripts/vendor-loom.sh`](scripts/vendor-loom.sh) resolves `refs/tags/v1.6.0`
on `awslabs/loom`, checks the commit it resolves to against a sha pinned in
the script (a tag is a mutable ref — this fails loudly rather than silently
vendoring different content if it's ever force-moved upstream), then a
sparse checkout of just `backend/`, `frontend/`, and `agents/` into
`vendor/loom` (gitignored) — not Loom's full tree.

Not required for typecheck/test/synth, which never touch `vendor/loom` even
when it exists (`tsconfig.json`'s `include` is an explicit allow-list that
never reaches it). **Run this right before a real deploy or a manual `docker
build`, not before `chant lint .`** — unlike `tsc`, `chant lint .` (and any
whole-project `chant build`/`chant lifecycle` invocation without `--src`
scoping) walks every `.ts` file under the given path with no gitignore-
awareness, so if `vendor/loom` exists on disk when it runs, it lints Loom's
own vendored frontend source as if it were project code. This repo's CI
never runs `npm run vendor`, so the gating `lint` job is unaffected; locally,
`rm -rf vendor/loom` before `just check` if you've vendored.

Two components wire a `docker-build` build phase against that checkout —
note that `loom-backend`'s context is the vendor root, not
`vendor/loom/backend` (see below for why):

| Component | `context` | `dockerfile` |
|---|---|---|
| `loom-backend` | `vendor/loom` | `backend/Dockerfile` |
| `loom-frontend` | `vendor/loom/frontend` | `Dockerfile` (default) |

`loom-backend`'s own `backend/Dockerfile` `COPY`s `agents/strands_agent/src/`
and its `requirements.txt` from *outside* `backend/` (Loom's own backend
bundles its low-code agent's source so it can build that agent's deploy
artifact at runtime) — a context scoped to just `backend/` can't see those
paths, so the build context has to be the vendor root, with `dockerfile`
pointing at `backend/Dockerfile` inside it. This is the same context/
Dockerfile pair Loom's own `shared/makefile` uses
(`podman build -f ../backend/Dockerfile ..`, run from `shared/`).
`loom-frontend`'s `Dockerfile` only `COPY`s paths from inside `frontend/`
itself, so its context is `vendor/loom/frontend` directly.

Both Dockerfiles were verified with a real `docker build` against a real
`v1.6.0` checkout while wiring this up (#20): `loom-backend`'s image builds
clean (and the container starts — it exits on no configured database, which
is expected without real `pDatabaseSecretArn`-equivalent config, not a build
defect); `loom-frontend`'s image builds clean and serves `/` over nginx with
no further configuration needed (its two `ARG`s, `VITE_API_BASE_URL` and
`VITE_COGNITO_USER_CLIENT_ID`, both default to `""`, matching Loom's own
`podman.build.frontend` target).

**`loom-agents` has no `docker-build` phase, and it's not just a modeling
choice.** `agents/strands_agent/` ships no `Dockerfile` upstream at all —
Loom's own backend builds this agent's deploy artifact as a Python zip
(`build_agent_artifact()` in `backend/app/services/deployment.py`) and
deploys it to Bedrock AgentCore Runtime via `codeConfiguration`, never a
container image. So `loom-agents.component.ts`'s `assistantImageUri`
staying an "already exists, supplied out-of-band" parameter isn't a gap this
vendoring step could close — see
`src/components/loom-agents.component.ts`'s docstring for the detail.

## Lifecycle Ops (chant#905)

Beyond the one-shot component deploys above, `ops/` holds the durable,
gated concerns for a *running* Loom deployment — upgrade/release, RDS data
safety, credential rotation, and teardown. These need an approval gate,
crash-resume, and saga rollback that the local executor cannot give them, so
they run as [chant Ops](https://intentius.io/chant/guide/ops/) on
[Temporal](https://temporal.io), built on the published
`@intentius/chant-lexicon-temporal`.

| Op | What it does | Gate? |
|---|---|---|
| `loom-upgrade-light` | Snapshot RDS → run migrations → promote-by-digest through `loom-backend`/`loom-frontend` | No — additive, local executor |
| `loom-upgrade-production` / `loom-upgrade-production-ha` | Same, plus an approval gate before the apply and an RDS-restore rollback on failure | Yes — needs `--temporal` |
| `loom-rotate-production` / `loom-rotate-production-ha` | Rotate the Cognito M2M app-client (blue/green — Cognito has no in-place secret regeneration), the RDS master credential, and (custom-domain tiers) the ALB's ACM certificate | Yes — every phase gates before the disruptive half |
| `loom-teardown` | Decommission whichever tier is live: gated, owned-only, marker-scoped stack deletes, no foreign deletes | Yes |

```
chant build ops                                   # compile to dist/ops/<name>/{workflow,activities,worker}.ts
chant run loom-upgrade-light                       # local executor, no Temporal server needed
chant run loom-upgrade-production --temporal       # pauses at "Approve"
chant run signal loom-upgrade-production approve-loom-upgrade-production
```

`ops/lib/` holds the shared, unit-tested pieces: `stack-refs.ts` derives every
physical identifier an Op needs from the same `loomNaming(...)` helper the
composites use (no `stackOutput`-style wiring exists at the Op layer — see
its docstring), `rds-safety.ts`/`rotation.ts`/`teardown-plan.ts` are pure AWS
CLI script builders (the same pattern
`lexicons/temporal/src/op/activities/apply.ts` uses upstream), and
`upgrade-op.ts`/`rotate-op.ts` are the factories the tier-specific `*.op.ts`
files call — one phase shape defined once, the chant#890 tier dial expressed
as config rather than three (or more) hand-copied Op bodies.

Migrations run against the backend's own task-definition family with an
overridden command — no rebuild, matching promote-by-digest — but the actual
migration entrypoint depends on Loom's own tooling (only known once
`vendor/loom` is checked out); override it via `LOOM_MIGRATION_COMMAND`
(comma-separated argv) — see `ops/lib/upgrade-op.ts`.
## Lifecycle: observe + reconcile (`chant#904`)

Beyond the initial stand-up, the running deployment is watched for drift and
kept in sync with source — the two `Ops` under [`ops/`](ops/):

| Op | Position | What it does |
|---|---|---|
| `loom-watch` (`ops/loom-watch.op.ts`) | observe | `WatchOp` on a 15-minute cron: `chant lifecycle diff --live` across every stack this build targets (all five components above, since chant's lifecycle commands build the whole project for the current `LOOM_ENV`/`LOOM_TIER`). Drift surfaces as the `Drift` search attribute. Runs on **every** tier. |
| `loom-reconcile` (`ops/loom-reconcile.op.ts`) | reconcile | `ReconcileOp`, owned-only (`scope: { owned: true }`): when live drifts from source, opens a cloud → code PR that regenerates the affected TypeScript. Never mutates the cloud, never commits to main. |

Both are stateless and retriable, so they run **one-shot on the local
executor** by default:

```
npm run watch        # chant run loom-watch
npm run reconcile     # chant run loom-reconcile
```

**Per-env dial (`chant#890`).** `light` sits at observe only; `production`/
`production-ha` additionally get `loom-reconcile` on an hourly schedule —
`ops/params.ts`'s `reconcilesOnScheduleForTier` decides, and `chant build`
simply has nothing to discover for the schedule on `light` (an `undefined`
export). `loom-watch` schedules on every tier.

Search attributes (`OpName`/`Watch`/`Env`/`Drift`/`Reconcile`/`PR`) are
registered via [`ops/search-attributes.ts`](ops/search-attributes.ts) so the
first scheduled run's `upsertSearchAttributes()` call succeeds. Ownership
marking (`chant.config.ts`'s `ownership` field) is what `scope: { owned: true }`
scopes reconciliation to — a foreign, non-chant resource is never touched.

Synthesize the generated workflow/worker code + `temporal-setup.sh` +
schedules:

```
npm run synth:ops    # chant build ops -o dist/temporal-manifest.txt
```

Emitting these as scheduled CI is `chant#906` — see "Scheduled CI" below.
The durable/gated concerns — upgrade, data-safety, rotation, teardown — are
`chant#905`, covered above. See `chant#903` for the lifecycle umbrella and
its per-operation-backend rule (CI-cron/local for observe+reconcile,
Temporal only for what needs a durable gate).

## Scheduled CI (`chant#906`)

Beyond running one-shot locally (`npm run watch`/`reconcile`/`audit`,
`just estimate-cost` — see above), the stateless lifecycle concerns also run
on a schedule via plain GitHub Actions cron — a second, independent trigger
host alongside (or instead of) each Op's own Temporal schedule.
`chant#906`'s settled decision: CI-cron is *one* trigger host, not the only
one. The durable/gated Ops (`chant#905` — upgrade, rotation, teardown) are
never scheduled here, only on Temporal, since they need a durable gate a
cron job cannot give them — no apply/rollback/gate logic is inlined into
this YAML at all (see `docs/src/content/docs/components/orchestration.mdx`'s
"keep logic out of the trigger").

| Workflow | Runs | Cron | Gate (opt-in) |
|---|---|---|---|
| [`.github/workflows/watch.yml`](.github/workflows/watch.yml) | `npm run watch` (`loom-watch`) | every 15 min | `vars.SCHEDULED_WATCH == 'true'` |
| [`.github/workflows/reconcile.yml`](.github/workflows/reconcile.yml) | `npm run reconcile` (`loom-reconcile`) | hourly | `vars.SCHEDULED_RECONCILE == 'true'` **and** `vars.LOOM_TIER` is `production`/`production-ha` (chant#890's dial — `light` observes only, same as the Temporal-scheduled path) |
| [`.github/workflows/cost-report.yml`](.github/workflows/cost-report.yml) | `npm run synth && npm run estimate-cost` (`chant#896`) | weekly, Monday 06:00 UTC | `vars.SCHEDULED_COST_REPORT == 'true'` |
| [`.github/workflows/audit.yml`](.github/workflows/audit.yml) | `npm run audit` (`loom-audit`) | daily | `vars.SCHEDULED_AUDIT == 'true'` |

Every one is a thin trigger — the single meaningful step is the same
`npm run <script>` a developer would run locally. All four also declare
`workflow_dispatch` for an on-demand run without waiting for the next tick.

**Enabling a schedule.** Each workflow stays inert until a team opts in —
the same pattern `deploy.yml` uses:

1. Set the workflow's repo **variable** (table above) to `true`.
2. `watch.yml`/`reconcile.yml` additionally need the `production`
   **environment** (AWS credentials) — the same one `deploy.yml` uses —
   since both run a live `chant lifecycle diff`. `cost-report.yml`/
   `audit.yml` never touch AWS.
3. `reconcile.yml` opens PRs via `gh pr create` — it needs `contents: write`
   + `pull-requests: write` (already declared in the workflow) and the
   default `GITHUB_TOKEN`, no extra secret to set.
4. `cost-report.yml`'s real numbers need `infracost` installed plus a repo
   secret `INFRACOST_CLI_AUTHENTICATION_TOKEN` — neither is provisioned by
   the workflow itself (see "Cost estimate (optional)" above); without them
   it still runs and prints a per-component skip notice, never fails.
5. Set repo variables `LOOM_ENV`/`LOOM_TIER` if this deployment isn't the
   `dev`/`light` defaults `ops/params.ts` falls back to.
6. `cost-report.yml`'s `npm run synth` step needs the same adopter-supplied
   parameters a real deploy does (`LOOM_VPC_ID`/`LOOM_PRIVATE_SUBNET_IDS`
   and friends — see "Adoption" above) wired in as environment variables;
   without them, synthesizing `loom-db` (and any other VPC-attached
   composite) fails the same way a real deploy would, since chant has no
   placeholder subnet/VPC ids of its own to invent.

**`loom-audit`'s finding-mode is `report` only.** `WorkflowAuditOp` accepts
`issue`/`pull-request` too, but the underlying `workflowSupplyChainAudit`
activity doesn't open the write itself yet — see
[`ops/loom-audit.op.ts`](ops/loom-audit.op.ts). A finding today surfaces by
reading the scheduled run's own output.

GitLab-cron equivalents are out of scope here — `chant#906` is GitHub-first,
matching `chant#892`'s GitLab-after ordering for the component pipeline.

## GitLab CI (chant#892)

`chant build --components --generate gitlab` synthesizes a `.gitlab-ci.yml`
from the same component declarations `chant graph --components` reads — one
stage per parallel-safe wave, one thin trigger job per component, `needs:`
mirroring `dependsOn`, and cross-stack/cross-job outputs threaded as job
artifacts (`--dump-outputs`/`--seed-outputs`). The generator itself lives in
chant (`lexicons/gitlab/src/components/generate-pipeline.ts`); this repo only
validates it against the real Loom component set.

```
npm run generate:gitlab   # chant build --components --generate gitlab -o .gitlab-ci.yml
just gitlab-validate      # regenerate + diff against the committed copy (fails on drift)
```

The committed [`.gitlab-ci.yml`](.gitlab-ci.yml) at the repo root is the
current shape — 3 waves, 6 jobs, from today's component set:

```
wave-1  shared-foundation, loom-cognito
wave-2  downstream-stub, loom-db, loom-frontend
wave-3  loom-backend
```

Regenerate it after any `dependsOn` change — `src/gitlab-pipeline.test.ts`
asserts the committed copy, the live component graph, and the generated
stage/job/`needs:` structure all agree.

**Wiring it into a real GitLab runner.** Every generated job is a thin
trigger (`chant run --components <name> --env production`) that assumes
`chant` and its deps already resolve and `dist/*.template.json` already
exists — neither is true in a bare checkout (`node_modules` isn't committed;
`dist/` is gitignored, see Deploy below). Wire this once, project-wide,
through `generateComponentPipeline`'s `beforeScript`/`image`/`extraScript`
options rather than per job:

- a custom runner `image` with `chant`, its deps, and `awscli` preinstalled
  (`cfn-deploy` shells out to the AWS CLI), with `dist/*.template.json` either
  baked in or produced by an earlier pipeline stage and passed forward as an
  artifact; or
- on a stock image, `beforeScript: ["npm ci", "npm run synth"]` plus an
  `awscli` install step.

### Runtime E2E (optional, on-demand)

`just gitlab-runtime-e2e` (`test/gitlab-runtime-e2e.sh`) proves the generated
pipeline's wave/`needs:`/artifact mechanics by actually running it —
`gitlab-ci-local` in Docker, against [Floci](https://floci.io) (a local AWS
emulator), no real AWS account. It deploys the light tier's 4 `infra`
components (`shared-foundation`, `loom-cognito`, `loom-db`,
`downstream-stub`) end to end, including the real cross-stack output
threading `loom-db`/`downstream-stub` need from `shared-foundation` across a
`needs:` edge. `loom-backend`/`loom-frontend` are excluded — their `build`
phase needs the `vendor/loom` Docker context (see Components above), a
separate, heavier concern than validating the generator's own mechanics.

Needs Docker; skips cleanly otherwise. Not part of gating CI — mirrors
chant's own `just gitlab-runtime-e2e` convention.

```
just gitlab-runtime-e2e   # or: bash test/gitlab-runtime-e2e.sh
```

## Exportable artifact bundle (chant#901)

A third adoption on-ramp, beyond "run chant" and "adopt this repo": **consume
the output, skip the tool.** A team grabs the pre-synthesized CloudFormation
templates + generated CI and deploys with plain `aws cloudformation deploy`
— chant does not need to be installed at deploy time.

```
npm run export-bundle   # or: bash scripts/export-bundle.sh
```

writes `dist/bundle/loom-v1.6.0/{light,production,production-ha}/` — each
tier a self-contained directory: a synthesized, valid CloudFormation
template per real Loom component (`templates/`), the generated GitHub
Actions + GitLab CI pipelines (`ci/`), and this tier's own `manifest.json`.
See the bundle's own generated `README.md` (bundle root) for the deploy
order and the full CloudFormation parameter reference — it's regenerated
fresh from each run's own templates, so it can't drift from what's actually
in the bundle.

**Reuses chant's shipped mechanism, invents no new packaging.** Per
chant#901's settled decision, every template is folded into a chant Build
Archive manifest (`@intentius/chant/components/verbs/build-archive`,
chant#613's `template`-kind entry) via `addArchiveTemplate` — the same
content-addressed structure `docker-build`/`generate-sbom` already
accumulate for image builds. `EXPORT_PERSIST_LEDGER=true npm run
export-bundle` additionally persists each tier's manifest to this repo's
own `chant/lifecycle` orphan branch (chant's Build Ledger, chant#609) —
local git plumbing only, off by default so a plain export never mutates
git state as a side effect; add `EXPORT_PUSH_LEDGER=true` to also push it.

This script hand-rolls the manifest read/materialize step itself (no first-class
`chant` CLI does this yet) — `INTENTIUS/chant#929` proposes a `chant
components export` core command for exactly that, so a project like this
one wouldn't need its own `export-bundle.ts` at all.

See `scripts/export-bundle.ts`'s module doc for the full design, including
a documented, pre-existing chant-core limitation this export step surfaces
rather than silently patches: a handful of auto-detected cross-lexicon
`Outputs` entries on `shared-foundation` carry a dotted logical id that
isn't valid CloudFormation — tracked upstream as `INTENTIUS/chant#930`.

## Deploy

Deployment is via **GitHub Actions** (`.github/workflows/deploy.yml`), not a
separate CD tool. It's **gated** so it stays inert until you opt in:

1. Repo **variable** `DEPLOY` = `true`.
2. A GitHub **environment** named `production` holding the AWS credentials
   this job needs.

The deploy job vendors Loom's source, configures AWS credentials + ECR login,
and runs `chant run --components all --env "$LOOM_ENV"` — the same dependency-
ordered orchestrator the tutorial uses locally. It derives the wave order from
each component's `dependsOn`, builds and publishes the images by digest, and
applies each stack.

## Status

The full six-component stack builds Loom `v1.6.0`'s real images and deploys
end to end on the [Floci](https://floci.io) emulator (light tier) — 7/7 stacks
`CREATE_COMPLETE`, chant exit 0. The synthesized CloudFormation is fidelity-
audited against Loom's own `v1.6.0` templates and matches (resources, params,
outputs, container env — see `INTENTIUS/loomster#23`).

**Remaining before "a team runs this in production":**

- Real-AWS end-to-end run (`#22`) — `production` / `production-ha` synthesize
  and pass the fidelity audit but have not been deployed against a live account.
- `chant lifecycle snapshot|diff` against the whole project root fails on one
  export-name collision (`INTENTIUS/chant#932`); every per-component and
  per-component-graph command works.
- Adoption seams still to add: `reference-existing` for the ECS execution/task
  IAM roles.

Tracked against epic `INTENTIUS/chant#885` and the tracker `INTENTIUS/loomster#31`.
