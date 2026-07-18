---
title: Tutorial
description: From a clean clone to a browsable Loom on your laptop, to the light tier on a real AWS account, to production. One codebase, tier and target as parameters.
---

Every command below runs against the real composites and components in `src/`.
Follow it top to bottom and you have a working Loom deployment.

You can run these commands yourself, or hand them to your agent: the repo ships a
[loomster skill](/loomster/getting-started/overview/#drive-it-with-your-agent)
(`skills/loomster/SKILL.md`) that gives an agent the whole capability map, and
chant serves an MCP server (`chant serve mcp`) for inspecting and building the
graph. "Stand up Loom locally" is a reasonable first thing to ask it.

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
| `loom-agents` | The Bedrock AgentCore agents — the Strands assistant (code-config Runtime) on every tier. No-code harnesses are created on demand via Loom's app; a BYO container agent is opt-in via `LOOM_HARNESS_AGENT_IMAGE_URI` |

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

And it comes up **usable, not empty**. `local-up`'s last step seeds the app
through Loom's own API, so on first login the Security screen already has an
imported agent role and a Cognito authorizer, the Catalog is populated (a
deployed agent, a memory, an MCP server, an A2A agent), and the approval-policy
and permission-request tabs aren't blank. A fresh Loom database seeds almost
none of that on its own — see [Screens](/loomster/reference/screens/) for what's
populated and what's deliberately left empty (and why). You can confirm it:

```
just validate          # every screen loads with the data its profile seeds
```

`validate` is the "is this deploy actually usable" check — it walks each screen
and fails if a section that should be seeded is empty or an agent deploy died.

```
just local-down    # tear down the app stack and Floci
```

One thing is only partly local: **agent execution**. The AgentCore-enabled Floci
image emulates the control plane, so agents deploy and definitions are manageable,
but invoking one returns a canned stub rather than real reasoning — that needs
AgentCore on a live account. Beyond that, anything depending on real AWS behavior
(IAM enforcement, KMS crypto, CloudWatch telemetry) is a stand-in too. The full
list is in [Local caveats](/loomster/reference/local-caveats/). For everything
else, what you see locally is what the code actually does.

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

It's *serving* but not yet *usable* — the same fresh-database problem as local,
without local-up's auto-seed. Seed it once against the running app so the
Security screen has a role and authorizer and an agent can be deployed:

```
LOOM_API_BASE_URL=https://<your-alb-or-domain> npm run seed
```

On a real account the default profile is `foundation` — it imports the agent
execution role and registers a Cognito authorizer, and stops there. It does
*not* deploy a demo agent or create a memory, because those are billable on a
live account. See [Seeded defaults](/loomster/reference/seeding/) for the
profiles and [Screens](/loomster/reference/screens/) for what each populates.

Two caveats:

- **The agents wave needs Bedrock AgentCore enabled in your account and region.**
  It's the last wave, so if AgentCore isn't available, that stack errors *after*
  the web app is already up and serving. The browsable Loom doesn't depend on
  it. Everything through `loom-backend` stands up regardless.
- **Building images on Apple Silicon?** Set `LOOM_CPU_ARCHITECTURE=ARM64` before
  the run. Fargate task definitions default to `X86_64`; an arm64 image on an
  x86_64 task def exits immediately and the service crash-loops. `ARM64` runs the
  tasks on Graviton to match, and is cheaper. CI-built (x86) images need nothing.
  (The Floci image itself is multiarch, so it needs no platform flag either way.)

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
schedule, and, on `production-ha`, Multi-AZ RDS. The Strands assistant deploys on
every tier; no-code harness agents are created on demand through Loom's app.

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

### DNS

The production tiers serve on your own domain over HTTPS, so DNS is part of the
setup. `LOOM_DOMAIN_NAME` is always required; how the hosted zone and certificate
are handled has two paths:

- **Reference your existing zone (the common case).** Most teams already own the
  parent domain in Route53 and want loomster to add records to it, not create a
  new zone. Point it at your zone and a pre-validated cert:

  ```
  export LOOM_HOSTED_ZONE_ID=<your Route53 hosted zone id>
  export LOOM_CERTIFICATE_ARN=<your ACM certificate ARN, already DNS-validated>
  ```

  loomster creates no zone or cert — it adds the ALB alias record to your zone
  and attaches your cert to the HTTPS listener.

- **Let loomster provision a new zone + cert (the default).** Set only
  `LOOM_DOMAIN_NAME`; loomster creates a Route53 hosted zone and a DNS-validated
  ACM cert. You then delegate that subdomain from the parent zone by adding its NS
  records — the one manual step this path needs.

Set `LOOM_ROUTE53=omit` (and `LOOM_ACM=omit`) to drop the custom domain entirely
and serve on the ALB's own DNS name — the same thing the light tier does.

`shared-foundation` fails fast with a tier-specific message if the network vars
are missing on a production tier, rather than surfacing a generic error deep in
synthesis. Most teams don't let an application stack provision its own VPC, DNS
zone, ACM cert, or IAM roles anyway. See [Adoption](/loomster/adoption/overview/)
for how every one of those is a `reference-existing` parameter.

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
[Adoption](/loomster/adoption/overview/).

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
| Restore (snapshot/PITR + cutover) | `chant run loom-restore` | Yes, before cutover | Whichever tier is live |
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

GitHub, GitLab, and Forgejo are all at parity — each has a committed,
drift-validated, runtime-tested component pipeline plus gated deploy and
scheduled lifecycle workflows. [CI providers](/loomster/operations/ci/) covers the
per-provider detail.

## Cost (optional)

`npm run estimate-cost` shells out to [Infracost](https://www.infracost.io)
against the synthesized templates, one estimate per component. chant carries no
pricing data. This is plumbing. Without Infracost installed and authenticated,
every component prints a skip notice and the script exits `0`, never failing the
build.

## What loomster adds over the SAM baseline

Loom's upstream deploy is a manual, multi-step SAM process: clone three repos and
run `sam build` / `sam deploy` per stack, in order, by hand. loomster replaces that
with a typed, single-orchestrator build. The features it adds:

- **Author-time type-checking and lint of cross-resource references** — a wrong
  stack-output name or an unresolved `Ref` fails the build before synthesis, not as
  a `ROLLBACK_COMPLETE` on a live stack.
- **Cross-stack wiring without hand-written glue** — `loom-backend` resolves nine
  inputs across three upstream stacks via `stackOutput(...)`, with no parameter
  files and no copy-paste between applies.
- **One dependency-ordered orchestrator** — `chant graph --components` prints the
  exact order `chant run` and the generated pipeline both follow.
- **Build-once, promote-by-digest** — images build once and are referenced by digest
  through every later stage.
- **Tiering as configuration** — one composite per component, parameterized by tier,
  not three forked copies.
- **Generated CI** for GitHub, GitLab, and Forgejo, from the same graph the CLI reads.
- **A local emulator** — Floci runs the whole stack with no account and no cost, and
  the CloudFormation is identical between Floci and real AWS.

Two things are sometimes counted as advantages but are properties of CloudFormation,
not additions loomster makes: there is no separate state file (CloudFormation manages
state as a service, as vanilla SAM does), and the output is standard CloudFormation
you apply and walk away from (SAM emits CloudFormation too). What differs is the
authoring and orchestration path that produces the template, not the output format.

## Known gaps

- Both `production` and `production-ha` are validated end to end on a live account
  (7/7 stacks `CREATE_COMPLETE`, agents wave included; production-ha adds Multi-AZ RDS
  and a live credential rotation). They can run side by side in one account —
  production-ha was deployed as a second instance while production's resources were
  still up. The light tier is also applied live.
- Screen-level validation behind real Cognito authenticates with a throwaway admin the
  harness mints against the deployed pool (loomster seeds no users). Live checks so far
  cover stacks, tier resources, the served app, and the agent runtime; the minted-token
  per-screen pass runs inline on the next live apply.
- Agents deploy locally against the AgentCore-enabled Floci image, but real agent
  execution needs Bedrock AgentCore on a live account (not enabled everywhere).
  See steps 1 and 2.

The full seam-by-seam edges are in [Adoption](/loomster/adoption/overview/).

## Where to go next

- [Run Loom on your laptop](/loomster/guides/local/) — the local run in depth.
- [Screens](/loomster/reference/screens/) — what every screen shows after a deploy, and what's seeded.
- [Seeded defaults](/loomster/reference/seeding/) — the seed profiles and how to run them.
- [Local caveats](/loomster/reference/local-caveats/) — where local diverges from real AWS.
- [Adoption](/loomster/adoption/overview/) — the full bring-your-own-everything matrix.
- [CI providers](/loomster/operations/ci/) — GitHub, GitLab, and Forgejo support.
- [Backup & restore](/loomster/operations/backup-restore/) — data protection and the restore runbook.
- [Naming & tagging](/loomster/reference/naming/) — the naming convention in full.
- chant's own docs: [Components](https://intentius.io/chant/components/overview/),
  [Ops](https://intentius.io/chant/guide/ops/),
  [Local Testing](https://intentius.io/chant/local-testing/aws/).
