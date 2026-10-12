---
title: Security review
description: "For a security reviewer: the IAM roles and what each can reach, the network paths, who sees what inside Loom, what each CI job and Op touches, and the proof behind it."
---

## Works

- Every role loomster creates is listed with its trust and grants, and you can
  bring your own for each ([Security](/loomster/reference/security/)).
- Loom never creates IAM; agents run only with roles an admin registered and
  tagged into a group. Per-agent roles scope credential providers to one agent.
- The production [tiers](/loomster/concepts/tiers-and-instances/) run tasks in
  private subnets with no public IP, enforce Cognito MFA, and turn on deletion
  protection for the pool and the database.
- Secrets are encrypted on every tier, with no opt-out.
- Destructive changes (upgrade, rotation, restore, teardown) stop at an approval
  recorded in git ([Gated Ops](/loomster/concepts/gated-ops/)).
- Every pinned action in the workflows is checked against upstream by
  `loom-audit`.

## Differs

- The ALB accepts `0.0.0.0/0` by default, as in Loom's template; narrow it with
  `LOOM_ALB_INGRESS_CIDR`.
- The database accepts `10.0.0.0/8` by default; `LOOM_DB_SOURCE_SG=true` limits
  it to the ECS task security group.
- Rows without a `loom:group` tag are visible to super-admins only (Loom
  v1.9.0); approval policies have no group.
- loomster patches the vendored Loom twice: an opt-in Cognito endpoint used only
  by the local stack, and an IPv4 preference in Loom's SSRF guard
  ([Work with the local stack](/loomster/guides/run-locally-in-depth/#the-loom-patch)).

## First step

Read [Security](/loomster/reference/security/).

## Proof

The `backend/task-role` claim runs the backend task role through the IAM policy
simulator, and `backend/deploy-agent` deploys an agent through Loom as that role
on AWS; both also break on purpose and are caught
([Validation](/loomster/reference/validation/)).

## Then read

Tasks:
[Bring your own network and IAM](/loomster/guides/bring-your-own-network-and-iam/),
[Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/),
[Rotate credentials](/loomster/guides/rotate-credentials/),
[Recover from an IdP lockout](/loomster/guides/recover-from-an-idp-lockout/).

Explanation:
[Gated Ops](/loomster/concepts/gated-ops/),
[Provision, reference or omit](/loomster/concepts/adoption-seams/).

Reference:
[Security](/loomster/reference/security/),
[CI providers](/loomster/reference/ci/),
[Claims](/loomster/reference/claims/).
