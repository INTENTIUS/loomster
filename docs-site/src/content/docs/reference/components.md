---
title: Components
description: Each component stack loomster deploys, its dependencies, the phases chant runs for it, the stack name it gets and the outputs it hands to the stacks after it.
---

A [component](/loomster/concepts/glossary/#component) is one CloudFormation stack,
declared in `src/components/<name>.component.ts` and built from the composite in
`src/composites/`. Its stack is named `{project}-{env}-{instance}-{component}`,
so `loom-db` for project `loom`, env `prod`, [instance](/loomster/concepts/glossary/#instance) `a` is `loom-prod-a-loom-db`
([Naming and tagging](/loomster/reference/naming/)).

## Graph

| Component | Wave | Depends on | Phases |
|---|---|---|---|
| `shared-foundation` | 1 | | Synth, Apply |
| `loom-cognito` | 1 | | Synth, Apply |
| `loom-db` | 2 | `shared-foundation` | Synth, Apply |
| `loom-frontend` | 2 | `shared-foundation` | Synth, Build, Publish, Apply, Verify; Rollback on failure |
| `downstream-stub` | 2 | `shared-foundation` | Synth, Apply |
| `loom-backend` | 3 | `shared-foundation`, `loom-db`, `loom-cognito` | Synth, Build, Publish, Apply, Verify; Rollback on failure |
| `loom-agents` | 4 | `shared-foundation`, `loom-cognito`, `loom-backend` | Synth, Build, Apply, Verify |

`npx chant graph --components` prints the waves. `chant run --components <name>`
runs one component; `all` runs every one in order.

## Phases

- Synth builds the component's own template, `dist/<name>.template.json`, from
  the build parameters in the environment, so a deploy never applies a stale
  template.
- Build and Publish (frontend and backend) build Loom's image from `vendor/loom`
  and push it to ECR by digest. `npm run vendor` fetches the source first.
- Build (agents) packages the Strands assistant's code as a zip for
  AgentCore's code configuration; it has no container image.
- Apply deploys the stack, with the outputs of the stacks it depends on passed
  in as parameters.
- Verify, on real AWS only, waits for the ECS service to reach steady state and
  for `/health` (backend) or `/` (frontend) to answer through the ALB. [Floci](/loomster/concepts/glossary/#floci)
  doesn't serve the ALB to ECS path, so Verify is skipped there.
- Rollback puts the service's previous task definition back when a later phase
  fails.

## Build contexts

Loom's source isn't in this repository. `npm run vendor` (`scripts/vendor-loom.sh`)
resolves the pinned tag, checks it against the commit pinned in the script,
sparse-checks out `backend/`, `frontend/` and `agents/` into `vendor/loom`
(gitignored), and applies the patches in `scripts/loom-patches/`. Typecheck,
tests and synth never read it; a deploy's Build phase does.

| Component | Context | Dockerfile |
|---|---|---|
| `loom-backend` | `vendor/loom` | `backend/Dockerfile` |
| `loom-frontend` | `vendor/loom/frontend` | `Dockerfile` |

The backend's context is the vendor root because its Dockerfile also copies the
Strands agent's source from outside `backend/`, as Loom's own makefile does.
`loom-agents` has no image: Loom builds that agent as a Python zip for
AgentCore's code configuration. Remove `vendor/loom` before `chant lint .`,
which lints every `.ts` file under the project.

## Outputs

| Component | Outputs |
|---|---|
| `shared-foundation` | `oVpcId`, `oPublicSubnetIds`, `oPrivateSubnetIds`, `oAlbArn`, `oAlbDnsName`, `oHttpsListenerArn`, `oAlbSecurityGroupId`, `oEcsSecurityGroupId`, `oFrontendTargetGroupArn`, `oBackendTargetGroupArn`, `oEcrKmsKeyArn`, `oFrontendRepositoryUri`, `oBackendRepositoryUri`, `oArtifactBucket`, `oDomainName`, `oCertificateArn`, `oHostedZoneId`, `oEcsClusterArn`, `oEcsClusterName`, `oAgentRoleArn` |
| `loom-cognito` | `oCognitoUserPoolId`, `oCognitoUserPoolArn`, `oM2MClientId`, `oUserClientId` (production [tiers](/loomster/concepts/glossary/#tier)), `oCognitoDomain`, `oResourceServerIdentifier`, `oCognitoIssuer`, `oCognitoDiscoveryUrl`, `oCognitoTokenUrl` |
| `loom-db` | `oRdsEndpoint`, `oRdsPort`, `oRdsDbName`, `oProxyEndpoint` (production tiers), `oConnectEndpoint`, `oSecretsKmsKeyArn`, `oRdsSecretArn`, `oRdsCredentialsSecretArn` |
| `loom-backend` | `oServiceName` |
| `loom-frontend` | `oServiceName` |
| `loom-agents` | `oAssistantRuntimeArn`, `oAssistantRuntimeVersion`, `oAssistantEndpointArn`, `oAssistantMemoryArn`, `oAssistantWorkloadIdentityArn`, `oAssistantGatewayUrl`, `oAssistantCodeInterpreterRoleArn`, and the same for the optional harness agent |

A [seam](/loomster/concepts/glossary/#seam) set to `omit` drops its outputs. Outputs read from a referenced resource
pass its id straight through.

## Not a component

`loom-agent-role` stacks (`{project}-{env}-{instance}-agent-role-<agent>`) are
deployed by the `loom-agent-role` [Op](/loomster/concepts/glossary/#op), one per agent, and stay out of the graph,
so `chant run --components all` doesn't deploy them and `loom-teardown` doesn't
delete them ([Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)).
