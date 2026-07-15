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

`package.json` currently points `@intentius/chant`,
`@intentius/chant-lexicon-aws`, and `@intentius/chant-lexicon-temporal` at
`file:../chant/packages/core`, `file:../chant/lexicons/aws`, and
`file:../chant/lexicons/temporal` — a sibling checkout of the `chant`
monorepo. This is intentional while the Loom composites/Ops are built against
chant's current `main`, ahead of whatever chant release ships the primitives
they need.

**Before this repo's first real release, swap those three entries to
published version ranges** (e.g. `"@intentius/chant": "^0.18.0"`,
`"@intentius/chant-lexicon-aws": "^0.18.0"`,
`"@intentius/chant-lexicon-temporal": "^0.18.0"`) and drop the
sibling-checkout step from CI. Until then, `chant` must be checked out as a
sibling directory (`../chant` relative to this repo) for `file:` resolution
to work — CI does this explicitly (see `.github/workflows/ci.yml`).

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

## Lifecycle Ops (chant#905)

Beyond the one-shot component deploys above, `ops/` holds the durable,
gated concerns for a *running* Loom deployment — upgrade/release, RDS data
safety, credential rotation, and teardown. These need an approval gate,
crash-resume, and saga rollback that the local executor cannot give them, so
they run as [chant Ops](https://intentius.io/chant/guide/ops/) on
[Temporal](https://temporal.io), built on `@intentius/chant-lexicon-temporal`
(dev-linked the same way as `@intentius/chant`/`@intentius/chant-lexicon-aws`
— see above).

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

## Deploy

Deployment is via **GitHub Actions** (`.github/workflows/deploy.yml`), not a
separate CD tool. It's **gated** so it stays inert until you opt in:

1. Repo **variable** `DEPLOY` = `true`.
2. A GitHub **environment** named `production` holding the AWS credentials
   this job needs.

Right now the deploy step is a placeholder — the real `chant run` invocation
lands once the composites (`#886`-`#889`) and lifecycle Ops (`#903`) exist.

## Status

Early build-out, tracked against epic `#885`. See open issues under
`INTENTIUS/chant` labeled for the Loom-on-chant work for what's shipped vs.
pending.
