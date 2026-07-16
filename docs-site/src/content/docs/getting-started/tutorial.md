---
title: Tutorial
description: From a clean clone to a browsable Loom on your laptop, to the light tier on a real AWS account, to production. One codebase, tier and target as parameters.
---

This repo *is* the tutorial. Every command below runs against the real
composites and components in `src/`, not a toy example. Follow it through and
you have a working Loom deployment.

Two things vary, and they're independent:

- **Tier**. `light` / `production` / `production-ha`. Sizes one Loom: HTTP vs.
  HTTPS + PrivateLink, single-AZ RDS vs. Multi-AZ + RDS Proxy + rotation, one
  agent vs. two.
- **Target**. Either [Floci](https://floci.io) (a local AWS emulator, no account,
  no cost) or a real AWS account.

Nothing in the source changes between them. This tutorial walks three points on
those two axes, in order of how much they cost you:

1. **Light on Floci**. Browse a real Loom on your laptop, no AWS account.
2. **Light on real AWS**, the same tier deployed to an account for real. The
   cheapest self-contained real deployment.
3. **Production**. HTTPS, a custom domain, PrivateLink, Multi-AZ, a gated apply.

## Prerequisites

- Node.js 22+ and npm.
- Docker, for the local run and for building Loom's images. Not needed to
  synthesize, typecheck, lint, or test.
- The AWS CLI on `PATH`. The apply path shells out to it, against Floci or real
  AWS with the same binary.

```
git clone https://github.com/INTENTIUS/loomster
cd loomster
npm install
```

`npm install` pulls published `@intentius/chant` and its lexicons from npm.
There's no sibling checkout and no codegen step. A fresh clone builds on its
own.

## Orientation

Loom is six components, deployed in dependency order:

```
$ npx chant graph --components
Deploy order (waves apply top-to-bottom; a wave's components are parallel-safe):
  1. loom-cognito, shared-foundation
  2. downstream-stub, loom-db, loom-frontend
  3. loom-backend
  4. loom-agents
```

| Component | What it is |
|---|---|
| `shared-foundation` | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, the agent IAM role — everything else attaches to it |
| `loom-cognito` | Cognito user pool, hosted-UI domain, resource server, clients |
| `loom-db` | RDS Postgres and its secret; production adds RDS Proxy and rotation |
| `loom-frontend` | The frontend ECS Fargate service |
| `loom-backend` | The backend ECS Fargate service |
| `loom-agents` | The Bedrock AgentCore agents — one Strands agent on every tier, a second harness agent on production-ha |

`downstream-stub` in the graph is not part of Loom. It's a verification stack
that consumes `shared-foundation`'s outputs, proving they resolve for a real
consumer. It ships with the repo and rides the deploy waves; ignore it when
counting Loom's own moving parts.

Every physical name and cost tag comes from one call,
`loomNaming(params, component)`, keyed
`{project}-{env}-{instance}-{component}-{resource}`. Two of those segments are
the dials you'll set:

- **`LOOM_TIER`** sizes one Loom (the tier column above).
- **`LOOM_INSTANCE`** is the tenant/boundary segment. Two instance values are two
  collision-free Looms in the same account and region. That's the topology axis,
  see [Org topology](#org-topology).

## 1. Browse Loom on your laptop

The fastest way to see Loom running. No AWS account, no cost, just Docker.

```
just local-up
```

That brings up [Floci](https://floci.io) for the managed pieces (RDS, Cognito,
S3, ECR), vendors Loom `v1.6.0`, provisions the infrastructure on Floci, builds
the app images, and starts the frontend, backend, and a reverse proxy from a
chant-generated `docker-compose`. When it settles:

```
open http://localhost:8080
```

You land in the Loom UI as an admin `local-dev` user, no login step. The web
app runs for real: a genuine Postgres behind the backend API, the real schema
migrations, the real routers (catalog, settings, costs, memories, credentials,
and the rest). Browse all of it.

```
just local-down    # tear down the app stack and Floci
```

Two things don't run locally, both because they can't: **agents** (Bedrock
AgentCore has no local emulator. Agent *definitions* are manageable, but deploy
and invoke need real AWS) and anything that depends on real AWS behavior (IAM
enforcement, KMS crypto, CloudWatch telemetry). The full list is in [Local
caveats](/loomster/reference/local-caveats/). For everything else, what you see
locally is what the code actually does.

The [Run Loom on your laptop](/loomster/guides/local/) guide has the layer-by-layer
breakdown of what's real, what's a dev shortcut, and how the local run is wired.

## 2. Deploy the light tier to real AWS

The light tier is the cheapest real deployment: HTTP-only, single-AZ RDS, one
agent, and, this is the point, **it provisions its own network**. Hand it no
VPC and `shared-foundation` builds one. No platform-team subnets, no ACM
certificate, no domain. This is the tier you deploy first to see Loom stand up on
a real account.

Point the AWS CLI at your account (a profile, SSO, or exported credentials, the
usual way), then:

```
export LOOM_TIER=light LOOM_ENV=dev LOOM_INSTANCE=a
export AWS_REGION=us-east-2               # your region
export AWS_ACCOUNT_ID=<your account id>
export LOOM_DB_PASSWORD=<a real secret, not a literal in any file>
npm run vendor                            # fetch Loom v1.6.0 source for the image builds
npx chant run --components all --env dev
```

`--components all` runs every component in the dependency order from the graph,
threading each stack's outputs into the next (the cluster ARN, the DB secret,
the Cognito pool, and the rest). No parameter files, no copy-paste between
applies. It builds and publishes the frontend and backend images by digest and
applies each stack.

When it finishes, find the load balancer and open it:

```
aws elbv2 describe-load-balancers \
  --query "LoadBalancers[?contains(LoadBalancerName,'loom')].DNSName" --output text
# open http://<that-dns-name>/
```

Loom comes up on a real ALB, backed by real RDS and Cognito. This is the tier
that has been deployed end to end to a live account. The web app served, the
data plane real.

Two things to know going in:

- **The agents wave needs Bedrock AgentCore enabled in your account and region.**
  It's the last wave, so if AgentCore isn't available, that stack errors *after*
  the web app is already up and serving. The browsable Loom doesn't depend on
  it. Everything through `loom-backend` stands up regardless.
- **Building images on Apple Silicon?** Set `LOOM_CPU_ARCHITECTURE=ARM64` before
  the run. Fargate task definitions default to `X86_64`; an arm64 image on an
  x86_64 task def exits immediately and the service crash-loops. `ARM64` runs the
  tasks on Graviton to match, and is cheaper. CI-built (x86) images need nothing.

### Tear it down

```
chant run loom-teardown --temporal        # gated, deletes only what this deploy owns
```

Teardown is deliberately conservative: it deletes only stacks this deployment
created and pauses for approval first. It leaves three things on purpose, an
RDS **snapshot** (the DB's `DeletionPolicy`), the **S3 artifact bucket**, and the
**ECR repositories**, so a teardown never destroys data or images you might
want back. Empty and delete those by hand when you're sure. For a throwaway light
experiment you can also delete the CloudFormation stacks directly; the same
three survive and want the same manual cleanup.

## 3. Go to production

`production` and `production-ha` are the same source with a different tier. What
the output gains: HTTPS with an ACM certificate and a Route53 alias, PrivateLink
(an NLB plus a VPC endpoint service), the RDS Proxy and a credential-rotation
schedule, and, on `production-ha`, Multi-AZ RDS and a second, no-code agent
alongside the low-code one.

The trade for that is real inputs. Unlike light, production **does not provision
a network**. PrivateLink needs private subnets a from-scratch VPC never has, so
you bring your own:

```
export LOOM_TIER=production LOOM_ENV=prod LOOM_INSTANCE=a
export AWS_ACCOUNT_ID=<your account id>
export LOOM_VPC_ID=<real vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<subnet>,<subnet>
export LOOM_PRIVATE_SUBNET_IDS=<subnet>,<subnet>
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_DB_PASSWORD=<a real secret>
```

`shared-foundation` fails fast with a tier-specific message if the network vars
are missing on a production tier, rather than surfacing a generic error deep in
synthesis. Most teams don't let an application stack provision its own VPC, ACM
cert, or IAM roles anyway. See [Adoption](/loomster/guides/adoption/) for how
every one of those is a `reference-existing` parameter.

**The apply is gated.** `.github/workflows/deploy.yml` stays inert until you opt
in: set the repo variable `DEPLOY` to `true`, and provision a GitHub environment
named `production` holding the AWS credentials the job assumes. It then runs the
same `chant run --components all` orchestrator you ran by hand in step 2. For the
first real apply, run that sequence yourself behind your own change process, then
let the pipeline take over. The components don't change either way.

Beyond standing the stacks up, production gets the durable lifecycle Ops, gated
upgrade, credential rotation, teardown, and a scheduled observe/reconcile pair.
See [Lifecycle](#lifecycle) below.

## Choosing a tier and a topology

Both are environment variables every component reads:

| Variable | Values | What it sizes |
|---|---|---|
| `LOOM_TIER` | `light` \| `production` \| `production-ha` | HTTP-only ALB and a self-provisioned VPC vs. HTTPS + PrivateLink + custom domain; single-AZ RDS vs. Multi-AZ + RDS Proxy + rotation; one agent vs. two |
| `LOOM_INSTANCE` | any string, e.g. `a`, `prod-us` | which Loom this is — the boundary/tenant segment every name and tag carries |
| `LOOM_ENV` | any string, e.g. `dev`, `prod` | the environment label, threaded into naming, tags, and `chant.config.ts` |

A self-provisioned VPC exists only on `light`. `production` / `production-ha`
always require a referenced network, because PrivateLink needs private subnets a
from-scratch light VPC never builds.

## Adoption seams

Most platform teams own the VPC, KMS keys, ACM certs, and IAM roles centrally
and hand over ids. Every referenceable piece here exposes a
`provision | reference-existing | omit` choice through parameters, with
reference-existing network and IAM as the first-class case, not a fallback:

- **Network**. `LOOM_VPC_ID` / `LOOM_PUBLIC_SUBNET_IDS` / `LOOM_PRIVATE_SUBNET_IDS`
  wire the ALB, ECS tasks, and RDS into ids a platform team already owns.
- **Identity**. `LOOM_COGNITO_MODE=reference-existing` points this Loom at an
  existing pool, creating zero Cognito resources. This is also the multi-boundary
  pattern (see [Org topology](#org-topology)).
- **KMS / ECR / ACM / Route53 / the agent IAM role**, each with its own mode,
  independent of the others.

None of this forks a composite. `src/examples/byo/` is a runnable proof: every
seam across all five composites set to `reference-existing`, against one set of
platform-owned resources, with no edits under `src/composites/`. The full
seam-by-seam matrix, every default and what replacing it requires, is in
[Adoption](/loomster/guides/adoption/).

## Org topology

Loom is one control plane with logical, group-based multi-tenancy, not hard
isolation between teams. Two topologies:

- **Single-boundary**. One Loom, many Cognito groups. RBAC plus the
  `loom:group` / `loom:application` / `loom:owner` tags `loom-cognito` attaches
  give each team a scoped view without a second deployment. Right when every team
  fits inside one compliance and account boundary.
- **Multi-boundary**, many Looms, one per account, prod-vs-nonprod, or
  compliance domain, each a different `LOOM_INSTANCE`. A shared org-level Cognito
  pool (or an external OIDC IdP fronted the same way) is referenced by every
  instance via `LOOM_COGNITO_MODE=reference-existing`, with groups and scopes
  defined once at the org level.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** If two
teams should never see each other's Loom resources, that's a separate instance.
If they should, but scoped, that's a group and an ABAC tag inside one Loom.
`src/examples/byo/` instantiates the identity composite twice under two instance
values against the identical pool, proving both resolve to the same pool id with
zero members provisioned by either.

## Lifecycle

Standing the stacks up is the start. Beyond the component deploys:

| Concern | Command | Gated? | Runs on |
|---|---|---|---|
| Observe (drift detection) | `npm run watch` | No | Every tier |
| Reconcile (cloud-to-code PR, owned-only) | `npm run reconcile` | No — opens a PR, never mutates the cloud | `production` / `production-ha` |
| Upgrade (snapshot, migrate, promote-by-digest) | `chant run loom-upgrade-<tier>` | On production tiers | Whichever tier is live |
| Rotate (Cognito M2M client, RDS credential, ACM cert) | `chant run loom-rotate-production[-ha]` | Every phase | `production` / `production-ha` |
| Backup (RDS snapshot + DR copy) | `chant run loom-backup` | No | Every tier |
| Teardown | `chant run loom-teardown` | Yes, owned-only | Whichever tier is live |

The observe and reconcile Ops are stateless, so they run one-shot on the local
executor (`npm run watch` / `npm run reconcile`) or on a schedule, either a
plain GitHub Actions cron or each Op's own Temporal schedule.

The upgrade, rotate, and teardown Ops need a durable approval gate and
saga-style rollback a one-shot run can't give them, so they run on
[Temporal](https://temporal.io). A gated Op pauses for a human:

```
chant run loom-upgrade-production --temporal        # pauses at "Approve"
chant run signal loom-upgrade-production approve-loom-upgrade-production
```

`loom-upgrade-light` is the exception. Additive only, nothing to gate, so it
runs on the local executor with no Temporal server.

## Generated CI

`chant build --components --generate gitlab` synthesizes `.gitlab-ci.yml` from
the same component graph the CLI reads. One stage per parallel-safe wave, one
job per component, `needs:` mirroring `dependsOn`, cross-stack outputs threaded
as job artifacts:

```
npm run generate:gitlab   # writes .gitlab-ci.yml
just gitlab-validate      # regenerate and diff against the committed copy
```

No hand-written pipeline to keep in sync with `dependsOn`. `just
gitlab-runtime-e2e` proves the generated pipeline actually executes. It runs
the real `.gitlab-ci.yml` in Docker against Floci, deploying the light tier's
infrastructure components end to end including the cross-stack output handoff
between waves. It needs Docker and isn't part of gating CI.

The stateless lifecycle concerns (`watch` / `reconcile` / `cost-report` /
`audit`) also run on plain GitHub Actions cron, inert until a team sets the
per-workflow variable. The README's "Scheduled CI" section has the exact
variables each one needs.

GitHub and GitLab both have the full generated-pipeline lifecycle (committed,
drift-validated, runtime-tested), GitHub additionally carries the deploy and
scheduled workflows, and Forgejo is on the roadmap. [CI
providers](/loomster/guides/ci/) covers where each stands.

## Cost (optional)

`npm run estimate-cost` shells out to [Infracost](https://www.infracost.io)
against the synthesized templates, one estimate per component. chant carries no
pricing data. This is plumbing. Without Infracost installed and authenticated,
every component prints a skip notice and the script exits `0`, never failing the
build.

## Positioning

Loom's own deploy today is a manual, multi-step SAM process behind a
`DEPLOYMENT.md`. You clone three repos and run `sam build` / `sam deploy` per
stack, in order, by hand. That's the baseline this replaces. Some of the
difference is a real improvement. Some of what sounds like a win is
CloudFormation-vs-Terraform, or no difference at all. Which is which:

**Real wins**

- **Author-time type-check and lint of cross-resource references.** A wrong stack
  output name or an unresolved `Ref` is a build failure before anything
  synthesizes, not a `ROLLBACK_COMPLETE` found against a live stack.
- **Cross-stack wiring without hand-written glue.** `loom-backend` alone resolves
  nine inputs across three upstream stacks via `stackOutput(...)`, with no
  parameter file and no copy-paste between applies.
- **One dependency-ordered orchestrator**, not a `DEPLOYMENT.md` a human executes
  by hand. `chant graph --components` prints the exact order `chant run` and the
  generated pipeline both run.
- **Build-once, promote-by-digest.** The images build once and are referenced by
  digest through every later stage, never a build-per-environment that drifts
  from what was tested.
- **Tiering as config, not three forked copies.** One composite each,
  parameterized by tier.
- **Generated CI** from the same graph the CLI reads, not a second source of
  truth to keep in sync.
- **A local emulator for the light tier.** Floci gives a no-account, no-cost path
  to run the whole thing before touching an account, and the CloudFormation
  doesn't change between Floci and real AWS. Only the endpoint does.

**Parity, not wins**

- **"No state file."** CloudFormation manages state as a service, true of vanilla
  SAM too. A real advantage over a Terraform-style state file, but not something
  chant adds on top of SAM.
- **Walk-away.** chant emits standard CloudFormation and stops. SAM does the same.
  The difference being argued for is the authoring and orchestration path that
  produces the template, not the output format.

## Known gaps

Written down rather than papered over:

- `production` / `production-ha` have been synthesized and fidelity-audited
  against Loom's `v1.6.0` templates, but not yet applied to a live account. The
  light tier has.
- Agents need Bedrock AgentCore, which has no local emulator and isn't enabled in
  every account. See steps 1 and 2.
- `loom-backend` / `loom-frontend` always provision their own ECS execution and
  task IAM roles. No `reference-existing` seam for those yet.

The full seam-by-seam edges are in [Adoption](/loomster/guides/adoption/).

## Where to go next

- [Run Loom on your laptop](/loomster/guides/local/) — the local run in depth.
- [Local caveats](/loomster/reference/local-caveats/) — where local diverges from real AWS.
- [Adoption](/loomster/guides/adoption/) — the full bring-your-own-everything matrix.
- [CI providers](/loomster/guides/ci/) — GitHub, GitLab, and Forgejo support.
- [Backup & restore](/loomster/guides/backup-restore/) — data protection and the restore runbook.
- [Naming & tagging](/loomster/reference/naming/) — the naming convention in full.
- chant's own docs: [Components](https://intentius.io/chant/components/overview/),
  [Ops](https://intentius.io/chant/guide/ops/),
  [Local Testing](https://intentius.io/chant/local-testing/aws/).
