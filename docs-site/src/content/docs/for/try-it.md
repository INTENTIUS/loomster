---
title: Try it
description: "For someone who wants to see Loom running: what works on a laptop, what differs from AWS, the first command, and what to read next."
---

## Works

- Loom v1.9.0 on your laptop with `just local-up`: Docker, no AWS account, no
  cost.
- A real Cognito login against a pool on [Floci](/loomster/concepts/glossary/#floci),
  as an admin with every scope.
- Every screen filled by the demo seed, and `just validate` checking them.
- Agents deploy to Floci's AgentCore control plane.

## Differs

- Invoking an agent returns a canned reply; real reasoning needs AWS.
- IAM isn't enforced unless you opt in, Evaluations aren't emulated, and no
  telemetry is shipped, so costs and traces stay thin
  ([Local caveats](/loomster/reference/local-caveats/)).
- A proxy stands in for the ALB, with no TLS.

## First step

[Run Loom locally](/loomster/getting-started/).

## Proof

[Validation](/loomster/reference/validation/) lists what has run on Floci and on
AWS for each [tier](/loomster/concepts/tiers-and-instances/).

## Then read

Tasks:
[Browse Loom on your laptop](/loomster/tutorial/),
[Work with the local stack](/loomster/guides/run-locally-in-depth/),
[Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/).

Explanation:
[Architecture](/loomster/concepts/how-it-works/),
[Tiers and instances](/loomster/concepts/tiers-and-instances/).

Reference:
[Screens](/loomster/reference/screens/),
[Local caveats](/loomster/reference/local-caveats/).
