---
title: What loomster is
description: Component table, real wins vs. parity with Loom's own SAM deploy, org topology, and known gaps — the honest picture before you start the tutorial.
---

loomster is typed, tiered infrastructure-as-code for [awslabs/loom](https://github.com/awslabs/loom) on [chant](https://intentius.io/chant) — component-based, tiered (`light` / `production` / `production-ha`), with generated CI and a parameterization/naming scheme that lets multiple Loom instances coexist in one or many AWS accounts without collision. Pinned to Loom `v1.6.0`, a moving `as-is` AWS Labs sample — breaking changes are expected upstream between versions.

The full six-component stack builds Loom's real images and deploys end to end on a local emulator ([Floci](https://floci.io), light tier), and the synthesized CloudFormation is fidelity-audited against Loom's own `v1.6.0` templates. A real-AWS end-to-end run — the bar for calling this a production deployment a team has run for real — is still pending; see [Known gaps](#known-gaps).

This page is the short version: what's here, what's a genuine improvement over Loom's own deploy, what's just parity dressed up as a win, and where the edges are today. The [Tutorial](/loomster/getting-started/tutorial/) is the hands-on walkthrough; this page is the map.

## Components

Six stacks, deployed in dependency order (`chant graph --components`):

| Component | Depends on | What it is |
|---|---|---|
| `shared-foundation` | — | ALB, ECS cluster, ECR, KMS, S3 artifact bucket, DNS, agent IAM role |
| `loom-cognito` | — | Cognito UserPool, hosted-UI domain, resource server, clients |
| `loom-db` | `shared-foundation` | RDS Postgres, Secrets Manager, (full tier) RDS Proxy + rotation |
| `loom-frontend` | `shared-foundation` | The frontend ECS Fargate service |
| `loom-backend` | `shared-foundation`, `loom-db`, `loom-cognito` | The backend ECS Fargate service |
| `loom-agents` | `shared-foundation`, `loom-cognito`, `loom-backend` | The Bedrock AgentCore agent set — a low-code Strands agent (every tier) + a no-code AgentCore-harness agent (production/production-ha) |

`loom-backend`/`loom-frontend` each run build &rarr; publish &rarr; apply &rarr; verify, with a rollback compensation phase. Cross-stack inputs (cluster ARN, security group, target group, the DB connection secret, the Cognito user pool, ...) resolve via `stackOutput(...)`.

## Real wins vs. parity — don't oversell

Loom's own deploy today is a manual, multi-step SAM process behind a `DEPLOYMENT.md` — clone three repos, run `sam build`/`sam deploy` per stack, in the right order, by hand. That's the real baseline this deployment replaces. Some of the difference is a genuine improvement over that baseline. Some of what sounds like a chant-vs-SAM win is really a CloudFormation-vs-Terraform win, or isn't a difference at all.

**Real wins:**

- **Author-time type-check and lint of cross-resource references.** A wrong stack output name, an unresolved `Ref`, or a missing security-group rule is a build failure before anything synthesizes — not a `ROLLBACK_COMPLETE` discovered against a real (or emulated) stack.
- **Cross-stack wiring without hand-written glue.** `loom-backend` alone resolves nine inputs across three upstream stacks via `stackOutput(...)`, with no parameter file and no manual copy-paste between `sam deploy` invocations.
- **One dependency-ordered orchestrator**, not a `DEPLOYMENT.md` a human reads and executes by hand. `chant graph --components` prints the exact wave ordering `chant run --components` and the generated CI pipeline both execute.
- **Build-once, promote-by-digest.** `loom-backend`/`loom-frontend` build an image once and reference it by digest through every later stage.
- **Tiering as config, not three forked copies.** `light` / `production` / `production-ha` are one composite each, parameterized by tier — not three hand-maintained templates that drift apart.
- **Generated CI.** The pipeline comes from the same component graph the CLI itself reads — not hand-written and not a second source of truth to keep in sync.
- **Lifecycle beyond deploy.** Drift observation, cloud &rarr; code reconciliation, gated upgrade/rotate/teardown, and a supply-chain audit of this repo's own pinned CI action refs are all first-class.
- **A local emulator for the light tier.** [Floci](https://floci.io) gives a real-AWS-shaped, no-account, no-cost path to try the whole thing before touching a real account.

**Parity, not wins:**

- **"No state file."** CloudFormation already manages state as a service — that's true of vanilla SAM too. It's a real advantage over a Terraform-style state file, but it isn't something chant adds on top of SAM.
- **Walk-away / spec-true.** chant emits standard CloudFormation and stops. SAM does exactly the same thing. The actual difference being argued for is the authoring and orchestration path that produces the template, not the fact that the output format is CloudFormation.

See the Tutorial's [Positioning, honestly](/loomster/getting-started/tutorial/#positioning-honestly) section for the full argument.

## Org topology

Loom is one control plane with **logical** (group-based) multi-tenancy, not hard isolation between teams. Two topologies, and the choice should be deliberate:

- **Single-boundary** — one Loom, many Cognito groups. RBAC plus ABAC give each team a resource-scoped view without a second deployment. Right call when every team can live inside one compliance/data-residency/account boundary.
- **Multi-boundary** — many Looms, one per account / prod-vs-nonprod / compliance domain / data-residency requirement, each a different instance. A shared org-level Cognito pool (or an external OIDC IdP fronted the same way) is referenced by every instance, with groups and the scope catalog defined once, at the org level.

**Rule of thumb: groups inside a boundary, a new Loom per boundary.** If the answer to "should these two teams be able to see each other's Loom resources at all, ever" is no, that's a topology (instance/account) decision, not a group. If the answer is "yes, but scoped," that's a group plus an ABAC tag, inside one Loom.

See the Tutorial's [Org topology](/loomster/getting-started/tutorial/#org-topology) section for the runnable proof (`adoption.test.ts`) that the two axes are genuinely orthogonal.

## Known gaps

Documented here rather than papered over, so a team adopting this today knows exactly where the edges are:

- **Real-AWS end-to-end is not yet run.** The full stack deploys 7/7 on the Floci emulator (light tier), but the `production` / `production-ha` tiers have only been synthesized and fidelity-audited, not applied against a live AWS account (`INTENTIUS/loomster#22`). Floci proves the control plane (stacks reach `CREATE_COMPLETE`) but does not run the app workload, so the runtime Verify checks (`wait-steady-state`, `health-gate`) are gated to real AWS.
- `loom-backend`/`loom-frontend` always provision their own ECS execution/task IAM roles — no `reference-existing` seam for those yet.
- PrivateLink is tier-gated only, with no independent `omit` on `production`/`production-ha` (`INTENTIUS/loomster#29`).
- `loom-agents` does not yet synthesize the AgentCore code-interpreter execution role Loom ships in `code_interpreter_role.yaml` (`INTENTIUS/loomster#39`).
- No bastion composite — Loom's own upstream template doesn't define one either.
- `chant lifecycle snapshot|diff` against this repo's whole project root still fails to build on one remaining, more pervasive export-name collision (`INTENTIUS/chant#932`) — every per-component and per-component-graph command in the Tutorial is unaffected.

The full seam-by-seam detail — every default and what replacing it requires — is in [Adoption](/loomster/guides/adoption/).
