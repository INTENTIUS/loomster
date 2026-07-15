# loom-on-chant

Production deployment of [awslabs/loom](https://github.com/awslabs/loom) on
[chant](https://intentius.io/chant) — component-based, tiered
(`light` / `production` / `production-ha`), with generated CI and a
parameterization/naming scheme that lets multiple Loom instances coexist in
one or many AWS accounts without collision.

Not a demo. This is the deployment a team adopts to run Loom for real — same
bar as any other production stack. Loom's own deploy today is a manual
multi-step SAM process behind a `DEPLOYMENT.md`; chant types it, lints it,
dedupes the cross-stack glue, orders it, tiers it, and generates the pipeline.

Pinned to **Loom `v1.6.0`** (a moving `as-is` AWS Labs sample — breaking
changes expected upstream between versions).

Tracking: `INTENTIUS/chant#885` (epic) and its child issues.

## Repo shape

Standalone repo, modeled on `INTENTIUS/blacklight` — own `package.json`,
`justfile`, `tsconfig.json`, and `.github/workflows/`. It is deliberately
**not** an in-tree `chant` `examples/` dir: an example reads as a demo and
resolves unpublished workspace versions, whereas this must be
production-adoptable and track chant on its own release cadence.

### chant dependency: dev-linked now, published at release

`package.json` currently points `@intentius/chant` and
`@intentius/chant-lexicon-aws` at `file:../chant/packages/core` and
`file:../chant/lexicons/aws` — a sibling checkout of the `chant` monorepo.
This is intentional while the Loom composites are built against chant's
current `main`, ahead of whatever chant release ships the primitives they
need.

**Before this repo's first real release, swap those two entries to published
version ranges** (e.g. `"@intentius/chant": "^0.18.0"`,
`"@intentius/chant-lexicon-aws": "^0.18.0"`) and drop the sibling-checkout
step from CI. Until then, `chant` must be checked out as a sibling directory
(`../chant` relative to this repo) for `file:` resolution to work — CI does
this explicitly (see `.github/workflows/ci.yml`).

A **fresh** sibling `chant` checkout isn't usable as-is — `file:` linking only
symlinks the package itself, not its own dependencies or generated code:

```
cd ../chant && npm install               # chant's own deps (zod, tsx, typescript, ...)
cd ../chant/lexicons/aws && npm run generate   # codegen (gitignored src/generated/)
```

If you already have a `chant` checkout you've worked in before, it likely
already has both — this only bites a genuinely fresh clone (which is exactly
what CI does on every run).

## Develop

```
just install   # npm install (resolves the file:-linked chant + aws lexicon)
just build     # typecheck (helper, composites, project-local lint rules)
just lint      # chant lint . — core rules + .chant/rules/ project-local rules
just test      # vitest run
just check     # all of the above
```

## Naming & tagging

Every composite derives its physical resource names and cost-allocation tags
from one shared parameter source — see [`docs/naming.md`](docs/naming.md) for
the convention (segment order, per-service length/char limits, uniqueness
strategy) and [`src/lib/naming.ts`](src/lib/naming.ts) for the helper itself.
A project-local lint rule (`.chant/rules/no-hardcoded-name.ts`) flags a
hardcoded physical name in a composite.

Every taggable resource across all five composites carries the same five
keys, straight from `loomNaming(...).tags()` — no per-composite copy:

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

Five stacks, deployed in dependency order (`chant graph --components`):

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | — | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role (`#886`) |
| `loom-cognito` | — | Cognito UserPool, hosted-UI domain, resource server, clients (`#888`) |
| `loom-db` | `shared-foundation` | RDS Postgres, Secrets Manager, (full tier) RDS Proxy + rotation (`#887`) |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service (`#889`) |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service (`#889`) |

`loom-backend`/`loom-frontend` each run **build → publish → apply → verify**
(`docker-build` → `publish-image` promoted by digest → `cfn-deploy` →
`ecs-update-service` → `wait-steady-state` + `health-gate`), with a
`rollback-previous` compensation phase. Cross-stack inputs (cluster ARN,
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
`v1.6.0`). Check that repo out at `vendor/loom` (gitignored) before running
a real `chant run` deploy:

```
git clone --branch v1.6.0 https://github.com/awslabs/loom vendor/loom
```

Not required for typecheck/lint/test/synth — those never touch the
filesystem at `vendor/loom`, only an actual deploy does.

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

Out of scope here: emitting these as scheduled CI (`chant#906`, which this
work blocks) and the durable/gated concerns — upgrade, data-safety, rotation,
teardown (`chant#905`). See `chant#903` for the lifecycle umbrella and its
per-operation-backend rule (CI-cron/local for observe+reconcile, Temporal
only for what needs a durable gate).

## Deploy

Deployment is via **GitHub Actions** (`.github/workflows/deploy.yml`), not a
separate CD tool. It's **gated** so it stays inert until you opt in:

1. Repo **variable** `DEPLOY` = `true`.
2. A GitHub **environment** named `production` holding the AWS credentials
   this job needs.

Right now the deploy step is a placeholder — the real `chant run` invocation
lands once the composites (`#886`-`#889`) exist alongside the remaining
lifecycle Ops (`#905`, `#906`); observe + reconcile (`#904`) are covered
above.

## Status

Early build-out, tracked against epic `#885`. See open issues under
`INTENTIUS/chant` labeled for the Loom-on-chant work for what's shipped vs.
pending.
