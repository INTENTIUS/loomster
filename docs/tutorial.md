# Tutorial: adopting Loom on chant

Tracks `INTENTIUS/chant#895`. This is not a demo walkthrough of a separate
example — **this repo is the tutorial**. Every command below runs against
the real composites, components, and lifecycle Ops in `src/`/`ops/`. Follow
it end to end and you have a working Loom deployment, not a toy.

Two deploy paths, one codebase:

- **Light tier, against [Floci](https://floci.io)** — a local AWS emulator,
  no AWS account, no cost. Good for a first pass and for CI.
- **Production / production-ha, against real AWS** — gated, with an
  approval step before anything disruptive happens.

`tier` and `topology` are both just parameters. Nothing about the source
changes between them.

## Same philosophy, two layers

Loom's own [launch post](https://aws.amazon.com/blogs/opensource/building-secure-ai-agents-at-scale-introducing-loom-for-aws/)
states its deployment model plainly: "no code is generated at runtime and
deployed into any environment" — only configuration changes, and the
control plane manages that configuration. Because "the code does not
change from deployment to deployment," a platform team can "scan it once
for deployment" and then redeploy repeatedly by changing only config. That
is also chant's pitch, one layer down the stack:

- Loom scans the agent code once, ahead of any deployment; every redeploy
  after that changes configuration, never code. chant lints and
  type-checks a stack at author time, before anything synthesizes — a bad
  cross-stack reference is a build failure, not something discovered
  against a real (or emulated) stack.
- Loom never generates agent code at runtime. chant never generates
  infrastructure code at deploy time either — `chant build` emits a
  CloudFormation template once, and every environment applies that same
  template. Nothing is templated with string interpolation at `chant run`
  time.
- Loom redeploys by changing config, not by hand-editing a running agent.
  chant redeploys by changing `LOOM_TIER`/`LOOM_INSTANCE`/an adoption seam's
  `mode`, not by forking a composite per environment (see [Choosing a tier
  and a topology](#choosing-a-tier-and-a-topology) below).

Same discipline, applied to the layer underneath the one Loom's own blog
post is about. See [Positioning, honestly](#positioning-honestly) for where
that comparison holds and where it doesn't.

## Prerequisites

- Node.js 22+, npm.
- A sibling `../chant` checkout — this repo dev-links `@intentius/chant`
  and its lexicons via `file:` (see the root [README](../README.md)'s
  "chant dependency" section) ahead of a published release. Needs its own
  `npm install` plus `npm run generate` in `lexicons/aws` (and
  `lexicons/gitlab`/`lexicons/github` if you also touch CI generation).
- Docker, for the light-tier walkthrough (runs [Floci](https://floci.io)
  locally) — not needed for `npm run synth`, `npm run tsc`, `npm run lint`,
  or `npm test`.
- The AWS CLI on `PATH` — `cfn-deploy` shells out to it (against Floci or
  real AWS, same binary either way).
- For a real deploy of `loom-backend`/`loom-frontend` (not required for the
  light-tier infra walkthrough below): `awslabs/loom` checked out at
  `vendor/loom` (gitignored), pinned `v1.6.0` — see the root README's
  "Components" section.

```
git clone https://github.com/INTENTIUS/loomster
cd loomster
npm install
```

## Orientation

Seven stacks, deployed in dependency order:

```
$ npx chant graph --components
Deploy order (waves apply top-to-bottom; a wave's components are parallel-safe):
  1. loom-cognito, shared-foundation
  2. downstream-stub, loom-db, loom-frontend
  3. loom-backend
  4. loom-agents
```

`shared-foundation` (ALB, ECS cluster, ECR, KMS, S3, DNS, the agent IAM
role) is the one every other stack attaches to. `downstream-stub` is a
verification stack, not part of Loom itself — it proves `shared-foundation`'s
outputs actually resolve for a real consumer. See the root
[README](../README.md#components) for the full table.

Every physical name and cost-allocation tag traces back to one call —
`loomNaming(params, component)` in [`src/lib/naming.ts`](../src/lib/naming.ts)
— keyed `{project}-{env}-{instance}-{component}-{resource}`. Two axes matter
for this tutorial and they're independent of each other:

- **`tier`** (`light` / `production` / `production-ha`, env var `LOOM_TIER`)
  — sizes *one* Loom: HTTP vs. HTTPS+PrivateLink, single-AZ RDS vs.
  Multi-AZ + RDS Proxy + rotation, one AgentCore agent vs. two. See
  [`docs/naming.md`](naming.md).
- **`instance`** (env var `LOOM_INSTANCE`) — the tenant/boundary segment.
  Two different `instance` values are two collision-free Looms in the same
  account and region. This is the topology axis — see
  [Org topology](#org-topology) below.

`src/composites/tier-topology-matrix.test.ts` is the unit proof that these
two axes are genuinely orthogonal: same `instance`, different `tier`, same
physical name, different topology (PrivateLink present/absent); different
`instance`, same `tier`, same shape, different (collision-free) names.

## Part 1 — Light tier, against Floci

No AWS account. This walks through the four `infra`-archetype components
(`shared-foundation`, `loom-cognito`, `loom-db`, `downstream-stub`) — the
same four `just gitlab-runtime-e2e` exercises in CI. `loom-backend`/
`loom-frontend` are skipped here because their `build` phase needs the
`vendor/loom` Docker context (see Prerequisites); everything else about the
light tier is exactly what's below.

**1. Synthesize.** Pure codegen — no Docker, no AWS, no network calls. Set
`LOOM_TIER=light` plus a throwaway VPC/subnet pair and a DB password before
running it: `loom-db` needs a VPC/subnet pair regardless of tier (RDS
belongs in private subnets it doesn't provision itself — see
`docs/adoption.md`), and unlike `shared-foundation`'s network seam it
doesn't validate a missing one with a clean error — it's an unhandled
exception partway through the chain today. Real ids aren't needed yet, so
any placeholder string works for this step:

```
export LOOM_TIER=light LOOM_ENV=dev LOOM_INSTANCE=a
export LOOM_VPC_ID=vpc-fake
export LOOM_PUBLIC_SUBNET_IDS=subnet-fake1,subnet-fake2
export LOOM_PRIVATE_SUBNET_IDS=subnet-fake3,subnet-fake4
export LOOM_DB_PASSWORD=some-local-password
npm run synth
```

This runs every `synth:*` script in turn (`shared-foundation`,
`downstream-stub`, `loom-db`, `loom-cognito`, `loom-backend`,
`loom-frontend`, `loom-agents`, `ops`) and writes `dist/*.template.json` +
the compiled lifecycle Ops under `ops/dist/`.

**2. Start Floci** (a local, real-AWS-shaped emulator — no signing, no
account):

```
docker run -d --rm -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock \
  --name floci floci/floci:1.5.30
```

**3. Bootstrap a throwaway VPC + subnets** (`loom-db`'s BYO-network input —
Floci accepts a fake one just as readily as a real one):

```
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
ENDPOINT=http://localhost:4566
VPC_ID=$(aws --endpoint-url $ENDPOINT ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text)
PUB1=$(aws --endpoint-url $ENDPOINT ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PUB2=$(aws --endpoint-url $ENDPOINT ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)
PRIV1=$(aws --endpoint-url $ENDPOINT ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.11.0/24 --availability-zone us-east-1a --query 'Subnet.SubnetId' --output text)
PRIV2=$(aws --endpoint-url $ENDPOINT ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.12.0/24 --availability-zone us-east-1b --query 'Subnet.SubnetId' --output text)
```

**4. Point chant at Floci and re-synth with the real ids:**

```
export AWS_ENDPOINT_URL=http://localhost:4566
export LOOM_TIER=light LOOM_ENV=dev LOOM_INSTANCE=a
export LOOM_VPC_ID=$VPC_ID
export LOOM_PUBLIC_SUBNET_IDS=$PUB1,$PUB2
export LOOM_PRIVATE_SUBNET_IDS=$PRIV1,$PRIV2
export LOOM_DB_PASSWORD=tutorial-password-1234
npm run synth:shared-foundation
npm run synth:downstream-stub
npm run synth:loom-db
npm run synth:loom-cognito
```

**5. Apply, in dependency order** — `chant run --components` drives each
component's own build/publish/apply/verify phases through chant's
local-executor `interpret` driver (`AWS_ENDPOINT_URL` above is picked up by
every `aws ...` call the aws lexicon's capabilities shell out to, Floci or
real AWS alike):

```
npx chant run --components shared-foundation --env dev --dump-outputs shared-foundation.outputs.json
npx chant run --components loom-cognito --env dev
npx chant run --components loom-db --env dev --seed-outputs shared-foundation.outputs.json
npx chant run --components downstream-stub --env dev --seed-outputs shared-foundation.outputs.json
```

`--dump-outputs`/`--seed-outputs` are the same cross-stack-output handoff
the generated GitLab pipeline uses between wave-1 and wave-2 jobs (see
[Generated CI](#generated-ci) below) — `loom-db`/`downstream-stub` both
consume `shared-foundation`'s ECS security group / cluster ARN / listener
ARN / target-group ARNs / ECR URIs this way.

**6. Verify** the stacks actually exist, as real (emulated) CloudFormation:

```
for stack in shared-foundation loom-cognito loom-db downstream-stub; do
  aws --endpoint-url $ENDPOINT cloudformation describe-stacks \
    --stack-name "$stack" --query 'Stacks[0].StackStatus' --output text
done
# CREATE_COMPLETE, four times
```

**7. Tear down:**

```
docker rm -f floci
```

The fully automated version of the above — Docker-in-Docker via
`gitlab-ci-local`, running the actual generated `.gitlab-ci.yml` rather than
raw `chant run` — is `just gitlab-runtime-e2e` (`test/gitlab-runtime-e2e.sh`).
It's on-demand (needs Docker), not part of gating CI, and it's the thing
that keeps this section honest across chant releases.

## Choosing a tier and a topology

Both are environment variables read by every stack's own `params.ts`
(`src/shared-foundation/params.ts`, `src/loom-db/params.ts`, ...) — nothing
about which composite gets called or how it's called changes:

| Variable | Values | What it sizes |
|---|---|---|
| `LOOM_TIER` | `light` \| `production` \| `production-ha` | HTTP-only ALB + provisioned VPC scaffolding vs. HTTPS + PrivateLink + custom domain; single-AZ RDS vs. Multi-AZ + RDS Proxy + rotation; one agent vs. two (see the root README's "Components" table) |
| `LOOM_INSTANCE` | any string, e.g. `a`, `prod-us`, `shared-b` | which Loom this is — the boundary/tenant segment every physical name and tag carries |
| `LOOM_ENV` | any string, e.g. `dev`, `staging`, `prod` | the environment label, threaded into naming, tags, and `chant.config.ts`'s `environments`/`ownership` |

A from-scratch VPC (`network.mode: "provision"`) only exists on `light` —
`production`/`production-ha` always require a real, referenced VPC
(`LOOM_VPC_ID`/`LOOM_PUBLIC_SUBNET_IDS`/`LOOM_PRIVATE_SUBNET_IDS`), because
PrivateLink needs private subnets a from-scratch light-tier VPC never has.
`src/shared-foundation/network.ts`'s `resolveNetwork` fails fast with a
clear, tier-specific message the moment those are missing on a full tier,
rather than letting a generic composite error surface deep in synthesis.

## Part 2 — Production / production-ha, against real AWS

Same commands as Part 1, with `LOOM_TIER=production` (or
`production-ha`) and real AWS ids instead of Floci ones:

```
export LOOM_TIER=production LOOM_ENV=prod LOOM_INSTANCE=a
export AWS_ACCOUNT_ID=<your account id>
export LOOM_VPC_ID=<real vpc id>
export LOOM_PUBLIC_SUBNET_IDS=<real subnet id>,<real subnet id>
export LOOM_PRIVATE_SUBNET_IDS=<real subnet id>,<real subnet id>
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_DB_PASSWORD=<a real secret, not a literal in any file>
# unset AWS_ENDPOINT_URL — real AWS, no override
npm run synth
```

`npm run synth` synthesizes clean at `production` and `production-ha` the
same way it does at `light` — verified while writing this tutorial, no tier
special-cased away. What actually differs in the output: PrivateLink's NLB
+ `VPCEndpointService`, the ACM certificate + Route53 alias record, the RDS
Proxy + credential-rotation schedule, and (production-ha) Multi-AZ RDS and
the no-code AgentCore-harness agent alongside the low-code one.

**Applying to real AWS is gated, not automatic.** `.github/workflows/deploy.yml`
stays inert until a team opts in:

1. Set the repo **variable** `DEPLOY` to `true`.
2. Provision a GitHub **environment** named `production` holding the AWS
   credentials the job assumes.

Today `deploy.yml`'s own apply step is a placeholder (`echo "TODO: npx chant
run --components all --env prod"`) — wiring the real invocation through is
tracked as its own follow-up, and this tutorial isn't going to claim
otherwise. What *is* real and already shipped is everything the deploy step
would call: every component above, and the gated Ops below it. Run the
same `npx chant run --components <name> --env production` sequence from
Part 1 by hand (behind your own change-management process) until that
wiring lands, or wire it into `deploy.yml` yourself — nothing about the
components needs to change either way.

Beyond the initial stand-up, `production`/`production-ha` get durable,
gated Ops for the concerns a one-shot `chant run` doesn't cover — upgrade,
credential rotation, teardown — plus a scheduled observe/reconcile pair.
See [Lifecycle](#lifecycle-observe-reconcile-upgrade-rotate-teardown) below.

## Adoption seams

Most platform teams don't let an application stack provision its own VPC or
IAM roles — a platform/security team owns those centrally, and hands over
ids. Every referenceable piece of this deployment exposes a
`provision | reference-existing | omit` choice through parameters, with
**reference-existing network + IAM as the first-class, common-case
default** — not a fallback:

- **Network** — `LOOM_VPC_ID`/`LOOM_PUBLIC_SUBNET_IDS`/
  `LOOM_PRIVATE_SUBNET_IDS` wire the ALB, ECS tasks, and RDS straight into
  ids a platform team already owns. `provision` (2 public subnets, nothing
  else) exists for a from-scratch light-tier/local synth only.
- **Identity** — `LOOM_COGNITO_MODE=reference-existing` plus
  `LOOM_COGNITO_USER_POOL_ID`/`LOOM_COGNITO_DOMAIN`/... points this Loom at
  a pool a platform team already runs, creating zero Cognito resources of
  its own. This is also the multi-boundary pattern — see
  [Org topology](#org-topology) below.
- **KMS / ECR / ACM / Route53 / the agent IAM role** — each has its own
  `mode`, independent of the others.

None of this forks a composite. [`src/examples/byo/`](../src/examples/byo/)
is a runnable proof: every seam across all five composites set to
`reference-existing`, against one illustrative set of platform-team-owned
resources, zero edits under `src/composites/`. `docs/adoption.md` is the
full matrix — every seam, its default, what replacing it requires, and the
gaps that exist today (documented there rather than hidden — see
[Known gaps](#known-gaps) below).

## Org topology

Loom is one control plane with **logical** (group-based) multi-tenancy, not
hard isolation between teams. Two topologies, and the choice should be
deliberate rather than accidental:

**Single-boundary** — one Loom, many Cognito groups. RBAC (which UI/role a
user has) plus ABAC — the `loom:group`/`loom:application`/`loom:owner`
UserPool tags `loom-cognito` attaches (see
[`src/composites/loom-cognito.ts`](../src/composites/loom-cognito.ts)) —
give each team a resource-scoped view without a second deployment. Right
call when every team can live inside one compliance/data-residency/account
boundary.

**Multi-boundary** — many Looms, one per account / prod-vs-nonprod /
compliance domain / data-residency requirement, each a different
`LOOM_INSTANCE`. A shared org-level Cognito pool (or an external OIDC IdP
fronted the same way) is referenced by every instance —
`LOOM_COGNITO_MODE=reference-existing` — with groups and the scope catalog
defined **once**, at the org level, not re-provisioned per Loom.
[`src/examples/byo/loom-cognito/`](../src/examples/byo/loom-cognito/) and
[`src/examples/byo/loom-cognito-second-instance/`](../src/examples/byo/loom-cognito-second-instance/)
instantiate the identity composite twice, under two different
`naming.instance` values, against the identical pool — `adoption.test.ts`
asserts both resolve to the same pool id with zero members provisioned by
either.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** If
the answer to "should these two teams be able to see each other's Loom
resources at all, ever" is no, that's a topology (instance/account)
decision, not a group. If the answer is "yes, but scoped," that's a group
plus an ABAC tag, inside one Loom.

## Lifecycle: observe, reconcile, upgrade, rotate, teardown

Standing up the stacks is the start, not the whole lifecycle. Beyond the
component `deploy`/`build`/`apply` above:

| Concern | Command | Gate? | Runs on |
|---|---|---|---|
| Observe (drift detection) | `npm run watch` (`chant run loom-watch`) | No | Every tier, every 15 min once scheduled |
| Reconcile (cloud → code PR, owned-only) | `npm run reconcile` (`chant run loom-reconcile`) | No (opens a PR, never mutates the cloud or commits to main) | `production`/`production-ha` only (chant#890's dial — `light` observes only) |
| Upgrade (snapshot → migrate → promote-by-digest) | `chant run loom-upgrade-light` \| `loom-upgrade-production[-ha]` | Yes, on `production`/`production-ha` (an approval signal before the apply, RDS-restore rollback on failure) | Whichever tier is live |
| Rotate (Cognito M2M client, RDS credential, ACM cert) | `chant run loom-rotate-production[-ha]` | Yes, every phase | `production`/`production-ha` |
| Teardown | `chant run loom-teardown` | Yes, owned-only | Whichever tier is live |

A gated Op pauses for a human:

```
chant run loom-upgrade-production --temporal        # pauses at "Approve"
chant run signal loom-upgrade-production approve-loom-upgrade-production
```

`loom-upgrade-light` runs on the local executor, no Temporal server needed
— additive only, nothing to gate. Every other durable Op needs
`--temporal` because a durable wait-for-signal and saga-style rollback are
exactly what a one-shot local run can't give them.

**Known gap, filed as `INTENTIUS/chant#928`.** `npm run watch`/`reconcile`
call `chant lifecycle diff <env> --live` against the whole project root, and
that currently fails to build against this repo's actual tree — a stray
module-level side effect in `test/gitlab-runtime-e2e/build.ts`, plus an
entity-name collision between the real `src/loom-backend` stack and its
illustrative twin under `src/examples/byo/loom-backend/`, once both are
discovered in one unscoped build. Every command in Parts 1 and 2 above (and
`just gitlab-runtime-e2e`) is unaffected — the gap is specific to that one,
unscoped whole-project build path. Filed rather than hidden, same as
`docs/adoption.md`'s own known-gaps list.

## Generated CI

`chant build --components --generate gitlab` synthesizes
[`.gitlab-ci.yml`](../.gitlab-ci.yml) straight from the same component
declarations `chant graph --components` reads — one stage per
parallel-safe wave, one thin job per component, `needs:` mirroring
`dependsOn`, cross-stack outputs threaded as job artifacts:

```
npm run generate:gitlab   # chant build --components --generate gitlab -o .gitlab-ci.yml
just gitlab-validate      # regenerate + diff against the committed copy — fails on drift
```

Verified while writing this tutorial: `just gitlab-validate` reports no
drift against the current component set (4 waves, 7 jobs). No hand-written
pipeline YAML to keep in sync with `dependsOn` by hand.

Scheduled CI (`chant#906`) runs the stateless lifecycle concerns
(`watch`/`reconcile`/`cost-report`/`audit`) on plain GitHub Actions cron —
inert until a team opts in per-workflow. See the root README's
"Scheduled CI" section for the exact repo variables/environment each one
needs.

## Cost (optional)

`scripts/estimate-cost.sh` shells out to [Infracost](https://www.infracost.io)
against the templates `npm run synth` produces, one estimate per component.
chant carries no pricing data of its own — this is plumbing:

```
npm run synth
npm run estimate-cost
```

No hard dependency: without `infracost` installed and authenticated, every
component prints a skip notice and the script exits `0` — never a build or
CI failure. See the root README's "Cost estimate" section for the
CloudFormation-support caveat.

## Positioning, honestly

Loom's own deploy today is a manual, multi-step SAM process behind a
`DEPLOYMENT.md` — clone three repos, run `sam build`/`sam deploy` per
stack, in the right order, by hand. That's the real baseline this
deployment replaces. Some of the difference is a genuine improvement over
that baseline. Some of what sounds like a chant-vs-SAM win is really a
CloudFormation-vs-Terraform win, or isn't a difference at all — and this
section says which is which rather than rounding everything up.

**Real wins:**

- **Author-time type-check and lint of cross-resource references.** A
  wrong stack output name, an unresolved `Ref`, or a missing security-group
  rule is a build failure before anything synthesizes — not a
  `ROLLBACK_COMPLETE` discovered against a real (or emulated) stack.
- **Cross-stack wiring without hand-written glue.** `loom-backend` alone
  resolves nine inputs — the DB secret ARN, the Cognito pool id, the ECS
  cluster ARN, and six more — across three upstream stacks via
  `stackOutput(...)`, with no parameter file, no manual copy-paste between
  `sam deploy` invocations, and no custom script gluing one stack's output
  to another's parameter.
- **One dependency-ordered orchestrator**, not a `DEPLOYMENT.md` a human
  reads and executes by hand. `chant graph --components` prints the exact
  same wave ordering `chant run --components` and the generated GitLab
  pipeline both execute — one source of truth for "what depends on what,"
  not a doc that drifts from what people actually run.
- **Build-once, promote-by-digest.** `loom-backend`/`loom-frontend` build
  an image once and reference it by digest through every later stage —
  never a build-per-environment that can drift from what was tested.
- **Tiering as config, not three forked copies.** `light` / `production` /
  `production-ha` are one composite each, parameterized by `LOOM_TIER` —
  not three hand-maintained templates that drift apart over time as each
  one gets a one-off edit the others never see.
- **Generated CI.** `.gitlab-ci.yml` comes from the same component graph
  the CLI itself reads (`chant build --components --generate gitlab`) —
  not hand-written and not a second source of truth to keep in sync.
- **Lifecycle beyond deploy.** Drift observation, cloud→code reconciliation,
  gated upgrade/rotate/teardown, and a supply-chain audit of this repo's
  own pinned CI action refs (`loom-audit`) are all first-class, not
  something bolted on after the fact.
- **A local emulator for the light tier.** Floci gives a real-AWS-shaped,
  no-account, no-cost path to try the whole thing before touching a real
  account — the CFN this repo emits doesn't change between Floci and real
  AWS, only the endpoint does.

**Parity, not wins — don't oversell these:**

- **"No state file."** CloudFormation already manages state as a service —
  that's true of vanilla SAM too. It's a real advantage chant shares with
  every CloudFormation-based tool over a Terraform-style local/remote state
  file a team has to manage, lock, and reconcile by hand. It is not
  something chant adds on top of SAM.
- **Walk-away / spec-true.** chant emits standard CloudFormation and stops
  — no long-running control-plane process of its own. SAM does exactly the
  same thing; it also emits CFN and walks away. The walk-away cost is
  identical between the two. The actual difference this tutorial is
  arguing for is the authoring and orchestration path that produces the
  template — the type-checked composites, the cross-stack wiring, the one
  orchestrator, the generated CI — not the fact that the output format is
  CloudFormation rather than something chant keeps running.

## Known gaps

Documented here rather than papered over, so a team adopting this today
knows exactly where the edges are. The full list, including seam-by-seam
detail, lives in [`docs/adoption.md`](adoption.md)'s "Known gaps" section:

- `loom-backend`/`loom-frontend` always provision their own ECS
  execution/task IAM roles — no `reference-existing` seam for those yet.
- PrivateLink is tier-gated only, with no independent `omit` on
  `production`/`production-ha`.
- No bastion composite — Loom's own upstream template doesn't define one
  either.
- `chant lifecycle snapshot|diff` against this repo's whole project root
  currently fails to build (`INTENTIUS/chant#928`, see
  [Lifecycle](#lifecycle-observe-reconcile-upgrade-rotate-teardown) above)
  — every per-component and per-component-graph command in this tutorial is
  unaffected.
- `deploy.yml`'s real `chant run` invocation is still a placeholder — see
  [Part 2](#part-2--production--production-ha-against-real-aws) above.

## Where to go next

- [`docs/adoption.md`](adoption.md) — the full seam-by-seam adoption matrix.
- [`docs/naming.md`](naming.md) — the naming/tagging convention in full.
- [`src/examples/byo/`](../src/examples/byo/) — the runnable
  bring-your-own-everything example.
- The root [README](../README.md) — components, lifecycle Ops, scheduled
  CI, and generated-CI sections in full detail.
- chant's own docs: [Components Overview](https://intentius.io/chant/components/overview/),
  [Lifecycle Models](https://intentius.io/chant/concepts/lifecycle-models/),
  [Ops](https://intentius.io/chant/guide/ops/),
  [Local Testing (Floci)](https://intentius.io/chant/local-testing/aws/).
