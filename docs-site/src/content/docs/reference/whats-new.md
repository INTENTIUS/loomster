---
title: Changes on Loom v1.9.0
description: What changed in loomster since it moved to Loom v1.9.0 and chant 0.124, for someone who deployed an earlier loomster.
---

loomster deploys Loom v1.9.0 on [chant](/loomster/concepts/glossary/#chant) 0.124. If you deployed an earlier loomster
(Loom v1.6.0), these are the changes that reach you. Upgrading the Loom pin
itself is in [Upgrade Loom](/loomster/guides/upgrade-loom/).

## Loom v1.9.0

- Loom is pinned to v1.9.0, with two patches applied when it's fetched: an
  opt-in Cognito endpoint for the local login, and an IPv4 preference in Loom's
  SSRF guard so backends on IPv4-only networks don't reject logins
  ([Work with the local stack](/loomster/guides/run-locally-in-depth/#the-loom-patch)).
- The backend task role carries Loom v1.9.0's runtime grants: agent deploys,
  invokes, the Agent Registry under `agent-registry:*`, `loom/*` secrets,
  Evaluations, and `bedrock-mantle:CreateInference`
  ([Security](/loomster/reference/security/#backend-task-role)).
- The shared agent role matches Loom's `role.yaml`, and `just agent-role` makes
  one role per agent ([Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)).
- The `settings:*` Cognito scopes and the permission-requests feature are gone,
  as in Loom.
- Chant-managed agent runtimes run on AgentCore Runtime V2.
- `LOOM_USE_SYSTEM_TRUST_STORE` runs the backend behind a TLS-inspecting proxy.

## Seed and validation

- The demo seed adds an evaluation test case and run, and a skill when an Agent
  Registry is configured. The demo agent's model is chosen from a fixed list for
  the region.
- `just validate` checks 24 endpoints, including Evaluations, Skills, approval
  logs and the model routes ([Screens](/loomster/reference/screens/#validation-checks)).

## Ops

- Every component synthesizes its own template when it deploys, so a deploy
  never applies a stale one.
- Every build parameter has a `LOOM_*` variable, and an unmapped variable is
  ignored ([Build parameters](/loomster/reference/parameters/)).
- Teardown covers every component in the graph, deletes the credential
  providers its Loom recorded, and deletes the tunnel host first.
- Loom's schema belongs to SQL Yodeler (`db/`): the v1.9.0 baseline, one
  reviewed migration per Loom version, a read-only database user, drift
  reports, and an upgrade [Op](/loomster/concepts/glossary/#op) that applies the pending migrations behind a
  plan-bound approval before it rolls the backend, then runs one-time scripts
  ([Migrate Loom's database](/loomster/guides/migrate-the-database/)).
- New: `loom-bootstrap`, `loom-tunnel-host`, and Ops for Loom's operator make
  targets ([Loom make targets](/loomster/reference/make-targets/)).

## Local stack

- Floci 2.2.0 (loomster's own build, `ghcr.io/lex00/floci`), a real Cognito login against Floci with Loom's dev-auth bypass
  off ([Run Loom locally](/loomster/getting-started/)).

## Proof

- [Claims](/loomster/reference/claims/): one script per capability, each able to
  fail on purpose, with a human gate in front of the ones that deploy.
  [Validation](/loomster/reference/validation/) records the results.
