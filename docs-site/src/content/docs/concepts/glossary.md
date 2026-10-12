---
title: Glossary
description: The loomster, chant and Loom words these pages use, each in a sentence or two with a link to where it is explained in full.
---

## AgentCore

Amazon Bedrock AgentCore, the AWS service that runs Loom's agents: Runtime,
Memory, Gateway, workload identity and Evaluations. Loom drives it through its
control plane (`bedrock-agentcore-control`) and data plane (`bedrock-agentcore`).

## BREAK

The second run of every [claim](#claim). With `BREAK=1` the claim breaks its own
property on purpose and must report `caught`. See [Claims](/loomster/reference/claims/#break).

## chant

The infrastructure-as-code tool loomster is written in. It types and lints the
stacks, synthesizes CloudFormation, orders the components, runs the [Ops](#op)
and generates CI. You run loomster by its verbs and need to know little chant.
[chant's docs](https://intentius.io/chant/), and [Choosing chant](/loomster/concepts/why-chant/) for
the reasons loomster uses it.

## chant/lifecycle

The git branch chant records Op runs, gates and approvals on (the ledger). A
gated Op reads its approval from it. See [Gated Ops](/loomster/concepts/gated-ops/).

## Claim

A script in `test/claims/<area>/<part>.sh` that checks one statement these docs
make and prints one verdict line. See [Claims](/loomster/reference/claims/) and
[Validation](/loomster/reference/validation/).

## Component

One CloudFormation stack in the deploy graph, declared in
`src/components/<name>.component.ts`: `shared-foundation`, `loom-cognito`,
`loom-db`, `loom-frontend`, `loom-backend`, `loom-agents` and the
verification-only `downstream-stub`. See [Components](/loomster/reference/components/).

## Composite

The typed building block behind a component, in `src/composites/`. A composite
takes [tier](#tier), naming and [seam](#seam) props and returns the resources.

## Floci

A local AWS emulator. loomster runs the managed pieces of the stack (RDS,
Cognito, S3, ECR, ECS, the AgentCore control plane) on Floci for the local
run and the Floci claims. What it does not reproduce is in
[Local caveats](/loomster/reference/local-caveats/).

## Gate

A step in an [Op](#op) that stops the run (exit code 3) until someone records an
approval with `chant approve <op> <gate>`. See [Gated Ops](/loomster/concepts/gated-ops/).

## Grant

A person's permission for a coding agent to run named [claims](#claim) or E2E
scripts that hold real infrastructure, given with `just grant`. See
[Claims](/loomster/reference/claims/#the-gate-and-grants).

## Instance

The `LOOM_INSTANCE` segment of every name and stack. Two instance values are two
separate Looms in one account and region. See
[Tiers and instances](/loomster/concepts/tiers-and-instances/).

## Loom

[awslabs/loom](https://github.com/awslabs/loom), the AWS Labs application for
building, deploying and governing agents on AgentCore. loomster deploys Loom
v1.9.0.

## Op

A lifecycle workflow in `ops/<name>.op.ts`, run with `chant run <name>`: backup,
restore, upgrade, rotate, teardown, seed, drift watch and the rest. See
[Ops](/loomster/reference/ops/).

## Seam

A point where a [composite](#composite) lets you provision a piece of
infrastructure, reference one you already have, or omit it. See
[Provision, reference or omit](/loomster/concepts/adoption-seams/) and the
[seam matrix](/loomster/reference/adoption-seams/).

## Seed profile

What `loom-seed` writes into Loom's database through its API: `foundation`,
`demo` or `none`. See [Screens](/loomster/reference/screens/#seed-profiles).

## stackOutput

chant's cross-stack reference. A component reads another component's
CloudFormation output by name, and `chant run --components` passes the value
along, so no parameter files are copied between stacks.

## Tier

`light`, `production` or `production-ha` (`LOOM_TIER`): the size and shape of
one Loom. See [Tiers and instances](/loomster/concepts/tiers-and-instances/) and
[Tiers and targets](/loomster/reference/tiers/).

## Wave

A set of components with no dependency between them, deployed together.
`npx chant graph --components` prints the waves.
