#!/usr/bin/env bash
# target: floci
# tier: light
# summary: Loom's own API deploys an agent on Floci with IAM enforced, running as the backend task role, and it reaches READY
#
# The free, local counterpart of backend/deploy-agent: Floci can enforce
# IAM (FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true) and vend the task role's
# credentials to ECS task containers (FLOCI_SERVICES_ECS_TASK_ROLE_CREDENTIALS_ENABLED=true,
# which needs FLOCI_SERVICES_ECS_DOCKER_NETWORK on a user-defined network), so
# a backend running as an ECS task calls AgentCore as loomster's task role and
# a missing grant (#1) is denied, as on AWS.
#
# Planned shape:
#   plain   start ${LOOM_CLAIMS_FLOCI_IMAGE:-ghcr.io/lex00/floci:318204f} on its own
#           network with enforcement, task-role credentials and the seeded
#           deployer principal (FLOCI_SERVICES_IAM_SEED_DEPLOYER_PRINCIPAL=true,
#           keys floci/floci); deploy the light tier with
#           `chant run --components all`; reach the backend task; POST
#           /api/agents (source=deploy), poll for READY.
#   BREAK   attach an inline Deny on bedrock-agentcore:*, bedrock:* and
#           iam:PassRole to the backend task role, expect the deploy to fail.
#
# Not built yet; each of these is unproven and the claim cannot run without it:
#   1. The API: Floci does not emulate the ALB to ECS data path, so the claim
#      has to reach the backend task's container directly on the Floci
#      network (a curl container on that network, or docker exec).
#   2. Auth: the light tier gives the backend LOOM_COGNITO_USER_POOL_ID, and
#      Loom validates tokens against the real cognito-idp JWKS URL, not
#      Floci's. loomster's Loom patch (scripts/loom-patches/, used by
#      local-up since #58) adds LOOM_COGNITO_ENDPOINT_URL for exactly this;
#      the light tier's task definition would need to set it.
#   3. The database: the task container must reach Floci's RDS endpoint from
#      the user-defined network (LOOM_DATABASE_URL is plain env on light).
#   4. A model: GET /api/agents/models must list one from Floci's Bedrock.
#   5. The agent code: READY needs Floci's AgentCore to accept the artifact
#      Loom uploads; local-up shows this works under compose, not yet as an ECS
#      task with enforcement on.
# What Floci cannot prove even then: real AgentCore and Bedrock behaviour, and
# any IAM condition key or service-linked-role path Floci's evaluator does not
# model. backend/deploy-agent on AWS stays the claim of record.
set -euo pipefail
echo "CLAIM claim=backend/deploy-agent-floci verdict=pending needs a Floci (${LOOM_CLAIMS_FLOCI_IMAGE:-ghcr.io/lex00/floci:318204f}) harness with IAM enforcement and ECS task-role credentials that reaches the backend task directly (no ALB data path), with Cognito omitted or Floci's JWKS honoured, the task reaching Floci RDS, and a Floci model listed; see the header"
