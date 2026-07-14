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
