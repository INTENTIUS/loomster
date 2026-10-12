---
title: Validation
description: What has been shown to work, on which tier and target, by which recorded claim or end-to-end run, and what nothing has shown yet. The one status page for loomster.
claims: [backend/deploy-agent, backend/task-role, params/reach-build, params/reach-deploy, teardown/covers-components]
---

This is the only page that states loomster's status. Other pages link here
rather than repeat it.

## By tier and target

Each [tier](/loomster/concepts/tiers-and-instances/) on each target: the
[Floci](/loomster/concepts/glossary/#floci) emulator and a real AWS account.

| Tier | Floci | Real AWS |
|---|---|---|
| `light` | All seven stacks `CREATE_COMPLETE`, including the agents wave on Floci; the local app runs with a real Cognito login (`just local-up`) | Deployed end to end: the ALB serves Loom, backed by RDS and Cognito, and the backend passes its health check. `backend/deploy-agent` deployed an agent through Loom's API to `READY` on this tier |
| `production` | All seven stacks against a bring-your-own VPC, with every tier resource: RDS Proxy, PrivateLink, ACM and Route53, backend autoscaling, the assistant runtime (`just production-floci-e2e`) | All seven stacks `CREATE_COMPLETE` on a custom domain over HTTPS, the assistant runtime `READY` on AgentCore, and the 15 screen checks the harness had at the time passed through a token from an MFA-enforced pool (`just production-live-e2e`) |
| `production-ha` | As production, plus Multi-AZ RDS, rotation and the two-task floor (`just production-ha-floci-e2e`) | All seven stacks, Multi-AZ RDS and the rotation schedule live, served over HTTPS, the assistant `READY`. It ran as a second [instance](/loomster/concepts/glossary/#instance) next to production in the same account |

Floci runs RDS as one container, so `MultiAZ` is requested and reported `false`,
and it doesn't serve the ALB to ECS path, so the health check only runs on AWS.

## Recorded claims

Each [claim](/loomster/reference/claims/) runs twice: plain, where it must pass,
and under `BREAK=1`, where it breaks its own property and must report `caught`.
`just claims` records every run in `test/.state/claims.json`.

| Claim | Target | Plain | BREAK | Recorded |
|---|---|---|---|---|
| `backend/deploy-agent` | aws | pass: Loom's API deployed an agent as the backend task role, `READY` in 306 s, and it answered one invoke | caught: with AgentCore, Bedrock, the registry and `iam:PassRole` denied to the task role, the deploy ended `FAILED` after 46 s | 2026-10-12, us-east-1 |
| `backend/task-role` | static | pass: the IAM policy simulator allows all 82 action and resource pairs | caught: with `iam:PassRole` dropped, 6 of 82 are denied | 2026-10-12 |
| `params/reach-build` | static | pass: `LOOM_DB_PASSWORD` reaches loom-db and `LOOM_CPU_ARCHITECTURE=ARM64` reaches the backend task definition | caught: unset, neither reaches its template | 2026-10-12 |
| `params/reach-deploy` | static | pass: the template `cfn-deploy` receives for loom-db is synthesized in the run and holds `LOOM_DB_PASSWORD` | caught: unset, it is absent | 2026-10-12 |
| `teardown/covers-components` | static | pass: all seven components are in the teardown order, consumers first | caught: with `loom-agents` dropped, the gap is named | 2026-10-12 |

The catalog also holds `backend/deploy-agent-floci`, `local/auth` and
`seed/demo-loud`, which have no recorded run. `bash test/claims.sh --list` prints
every claim with its target and statement.

## Not shown on any target

- Signing in to the served web app on a real AWS tier. loomster's frontend build
  on AWS passes no Cognito end-user client id, so the deployed app is used
  through its API with a token; the local stack does sign in through the form.
- Real agent reasoning on Floci: invoking an agent there returns a canned reply.
- The Evaluations and Skills seed steps against a live Loom, and the
  `bedrock-mantle:CreateInference` grant against a mantle-only model.
- The per-agent role stack from `loom-agent-role` on a live account.
- Chant-managed runtimes on AgentCore Runtime V2 reaching `READY` live.
- The generated Forgejo and GitHub deploy workflows against real infrastructure;
  their component pipelines run against Floci (`just github-runtime-e2e`,
  `just forgejo-runtime-e2e`).
