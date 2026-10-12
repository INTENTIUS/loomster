---
title: Estimate cost
description: Run Infracost against each synthesized component template for a per-component monthly estimate, locally or on a weekly schedule, with a skip notice when Infracost isn't set up.
prompt: |
  Read https://intentius.io/loomster/guides/estimate-cost/ and run `npm run synth` then `npm run estimate-cost` for the tier the person names.
  Report each component's estimate, or the skip notice and its reason.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A monthly estimate per component for a [tier](/loomster/concepts/tiers-and-instances/),
written to `dist/cost-estimates/`.

## Prerequisites

[Infracost](https://www.infracost.io) installed and signed in (`infracost auth
login`, or `INFRACOST_CLI_AUTHENTICATION_TOKEN` in CI). Without it every
component prints a skip notice and the script exits 0, so it never fails a
build.

## Steps

1. Synthesize the tier you want priced:

   ```
   LOOM_TIER=production npm run synth
   ```

2. Estimate:

   ```
   npm run estimate-cost
   ```

   It runs Infracost on each `dist/*.template.json` and prints what Infracost
   reports. [chant](/loomster/concepts/glossary/#chant) carries no pricing data. An Infracost error, such as expired
   credentials or a CLI version that can't read CloudFormation, is a skip with
   the reason.

3. To get it weekly, turn on `cost-report.yml` with `SCHEDULED_COST_REPORT=true`
   and the token secret ([Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/)).

The estimate covers the infrastructure. Agent runtime, model tokens, AgentCore
Memory and Evaluations are usage-based and outside it.

## Next

[Cost](/loomster/reference/cost/) for what drives cost on each tier.
