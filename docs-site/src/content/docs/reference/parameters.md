---
title: Build parameters
description: Every build parameter chant.config.ts declares, the LOOM_ environment variable that sets it, its type and default, and what it changes.
claims: [params/reach-build, params/reach-deploy]
---

The stacks read their settings as build parameters declared once in
`chant.config.ts` (`buildParams`). Each parameter has an environment variable;
[chant](/loomster/concepts/glossary/#chant) takes a value from `--param name=value`, then a `--params-file`, then that
variable, then the default. A variable that no parameter maps is ignored, so a
misspelled name changes nothing. `src/build-params.test.ts` holds every
parameter to its mapping, and `scripts/lint-docs.mjs` holds this page to
`chant.config.ts`.

Empty in the Default column means unset: the stack uses its
[tier](/loomster/concepts/tiers-and-instances/)'s value, or leaves the feature
off. Seams are explained in [Provision, reference or omit](/loomster/concepts/adoption-seams/).

## Shared by every stack

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_PROJECT` | `project` | string | `loom` | First segment of every name and stack name |
| `LOOM_ENV` | `env` | string | `dev` | Environment segment, and the chant environment |
| `LOOM_INSTANCE` | `instance` | string | `a` | Which Loom this is; two values are two separate deployments |
| `LOOM_TIER` | `tier` | string: `light`, `production`, `production-ha` | `light` | The tier |
| `AWS_REGION` | `region` | string | `us-east-1` | Deploy region |
| `AWS_ACCOUNT_ID` | `accountId` | string | | Account id for ARNs and the bucket and Cognito domain name suffix |
| `LOOM_OWNER` | `owner` | string | `platform` | The `owner` cost tag |

## loom-db

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_DB_MODE` | `dbMode` | string: `provision`, `reference-existing`, `omit` | `provision` | The database seam |
| `LOOM_DB_ALLOWED_CIDR` | `dbAllowedCidr` | string | | CIDR allowed to reach Postgres; `10.0.0.0/8` when unset, as in Loom's template |
| `LOOM_DB_SOURCE_SG` | `dbSourceSg` | boolean | `false` | Allow the ECS task security group instead of a CIDR |
| `LOOM_DB_NAME` | `dbName` | string | | Database name (also read by loom-backend) |
| `LOOM_DB_USERNAME` | `dbUsername` | string | | Master username (also read by loom-backend) |
| `LOOM_DB_PASSWORD` | `dbPassword` | string | | Master password; set it from a secret store, never a file |
| `LOOM_DB_INSTANCE_CLASS` | `dbInstanceClass` | string | | RDS instance class |
| `LOOM_DB_ALLOCATED_STORAGE` | `dbAllocatedStorage` | number | | Storage in GiB |
| `LOOM_DB_ENDPOINT` | `dbReferenceEndpoint` | string | | With `reference-existing`: your Postgres endpoint |
| `LOOM_DB_PORT` | `dbReferencePort` | number | | With `reference-existing`: its port |
| `LOOM_DB_CREDENTIALS_SECRET_ARN` | `dbReferenceCredentialsSecretArn` | string | | With `reference-existing`: the secret holding its credentials |
| `LOOM_DB_CONNECTION_SECRET_ARN` | `dbReferenceConnectionSecretArn` | string | | With `reference-existing`: an optional secret holding the connection URL |

## shared-foundation

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_DOMAIN_NAME` | `domainName` | string | | Custom domain; required on the production tiers |
| `LOOM_HOSTED_ZONE_ID` | `hostedZoneId` | string | | Reference an existing Route53 zone |
| `LOOM_ROUTE53` | `route53Mode` | string: `omit`, `provision` | | Drop or create the zone |
| `LOOM_CERTIFICATE_ARN` | `certificateArn` | string | | Reference an existing ACM certificate |
| `LOOM_ACM` | `acmMode` | string: `omit`, `provision` | | Drop or create the certificate |
| `LOOM_KMS_KEY_ARN` | `kmsKeyArn` | string | | Reference an existing KMS key for the ECR repositories |
| `LOOM_KMS` | `kmsMode` | string: `omit`, `provision` | | Drop or create the key |
| `LOOM_FRONTEND_REPOSITORY_URI` | `frontendRepositoryUri` | string | | Reference an existing frontend repository (with the other three) |
| `LOOM_FRONTEND_REPOSITORY_ARN` | `frontendRepositoryArn` | string | | |
| `LOOM_BACKEND_REPOSITORY_URI` | `backendRepositoryUri` | string | | |
| `LOOM_BACKEND_REPOSITORY_ARN` | `backendRepositoryArn` | string | | |
| `LOOM_ECR` | `ecrMode` | string: `omit`, `provision` | | Drop or create the repositories |
| `LOOM_AGENT_ROLE_ARN` | `agentRoleArn` | string | | Reference an existing shared agent execution role |
| `LOOM_AGENT_ROLE` | `agentRoleMode` | string: `omit`, `provision` | | Drop or create it |
| `LOOM_ALB_INGRESS_CIDR` | `albIngressCidr` | string | | CIDR allowed to reach the ALB; `0.0.0.0/0` when unset |
| `LOOM_LOGGING_BUCKET_NAME` | `loggingBucketName` | string | | An existing bucket for ALB, NLB and artifact bucket access logs |
| `LOOM_PRIVATELINK` | `privateLinkMode` | string: `provision`, `omit` | | PrivateLink; on by default on the production tiers |

The network itself (`LOOM_VPC_ID`, `LOOM_PUBLIC_SUBNET_IDS`,
`LOOM_PRIVATE_SUBNET_IDS`) is read when `shared-foundation` builds, alongside
these ([Bring your own network and IAM](/loomster/guides/bring-your-own-network-and-iam/)).

## loom-cognito

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_COGNITO_MODE` | `cognitoMode` | string: `provision`, `reference-existing`, `omit` | `provision` | The identity seam |
| `LOOM_COGNITO_CALLBACK_URLS` | `cognitoCallbackUrls` | string | | Hosted-UI callback URLs |
| `LOOM_COGNITO_RESOURCE_SERVER_ID` | `cognitoResourceServerId` | string | | Resource server identifier |
| `LOOM_COGNITO_SCOPES_JSON` | `cognitoScopesJson` | string | | Scopes, as JSON |
| `LOOM_COGNITO_UI_TIER_GROUPS_JSON` | `cognitoUiTierGroupsJson` | string | | Type groups (`t-admin`, `t-user`), as JSON |
| `LOOM_COGNITO_RESOURCE_GROUPS_JSON` | `cognitoResourceGroupsJson` | string | | Resource groups (`g-admins-*`, `g-users-*`), as JSON; none by default |
| `LOOM_COGNITO_DEMO_SEED_USERS_JSON` | `cognitoDemoSeedUsersJson` | string | | Demo users, as JSON; none by default |
| `LOOM_COGNITO_ABAC_APPLICATION` | `cognitoAbacApplication` | string | | `loom:application` tag value |
| `LOOM_COGNITO_ABAC_GROUP` | `cognitoAbacGroup` | string | | `loom:group` tag value |
| `LOOM_COGNITO_ABAC_OWNER` | `cognitoAbacOwner` | string | | `loom:owner` tag value |
| `LOOM_COGNITO_MANAGED_LOGIN_BRANDING` | `cognitoManagedLoginBranding` | boolean | | Managed Login branding on the end-user client (production tiers) |
| `LOOM_COGNITO_USER_POOL_ID` | `cognitoUserPoolId` | string | | With `reference-existing`: the pool |
| `LOOM_COGNITO_USER_POOL_ARN` | `cognitoUserPoolArn` | string | | Its ARN; derived when unset |
| `LOOM_COGNITO_DOMAIN` | `cognitoDomain` | string | | Its hosted-UI domain |
| `LOOM_COGNITO_M2M_CLIENT_ID` | `cognitoM2mClientId` | string | | Its machine-to-machine client |
| `LOOM_COGNITO_USER_CLIENT_ID` | `cognitoUserClientId` | string | | Its end-user client |
| `LOOM_COGNITO_ISSUER` | `cognitoIssuer` | string | | Its issuer; derived when unset |
| `LOOM_COGNITO_DISCOVERY_URL` | `cognitoDiscoveryUrl` | string | | Its discovery URL; derived when unset |
| `LOOM_COGNITO_TOKEN_URL` | `cognitoTokenUrl` | string | | Its token URL; derived when unset |

## loom-backend and loom-frontend

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_CPU_ARCHITECTURE` | `cpuArchitecture` | string: `X86_64`, `ARM64` | | Fargate CPU architecture; must match the built images (`ARM64` on Apple Silicon) |
| `LOOM_BACKEND_CPU` | `backendCpu` | string | | Backend task CPU units |
| `LOOM_BACKEND_MEMORY` | `backendMemory` | string | | Backend task memory |
| `LOOM_BACKEND_DESIRED_COUNT` | `backendDesiredCount` | number | | Backend task floor |
| `LOOM_BACKEND_MAX_COUNT` | `backendMaxCount` | number | | Backend autoscaling ceiling |
| `LOOM_BACKEND_LOG_RETENTION_DAYS` | `backendLogRetentionDays` | number | | Backend log retention |
| `LOOM_BACKEND_EXECUTION_ROLE_ARN` | `backendExecutionRoleArn` | string | | Reference an existing backend execution role (with the task role) |
| `LOOM_BACKEND_TASK_ROLE_ARN` | `backendTaskRoleArn` | string | | Reference an existing backend task role |
| `LOOM_FRONTEND_CPU` | `frontendCpu` | string | | Frontend task CPU units |
| `LOOM_FRONTEND_MEMORY` | `frontendMemory` | string | | Frontend task memory |
| `LOOM_FRONTEND_DESIRED_COUNT` | `frontendDesiredCount` | number | | Frontend task count |
| `LOOM_FRONTEND_LOG_RETENTION_DAYS` | `frontendLogRetentionDays` | number | | Frontend log retention |
| `LOOM_FRONTEND_EXECUTION_ROLE_ARN` | `frontendExecutionRoleArn` | string | | Reference an existing frontend execution role |
| `LOOM_COGNITO_REGION` | `cognitoRegion` | string | | Region of the Cognito pool, when it differs from the deploy region |
| `LOOM_ALLOWED_ORIGINS` | `allowedOrigins` | string | | CORS origins for the backend, comma-separated |
| `LOOM_REGISTRY_ID` | `registryId` | string | | The AgentCore Agent Registry Loom binds to |
| `LOOM_USE_SYSTEM_TRUST_STORE` | `useSystemTrustStore` | boolean | | Verify TLS against the OS trust store, for a TLS-inspecting proxy |
| `LOOM_LITELLM_PROXY_BASE_URL` | `litellmProxyBaseUrl` | string | | A LiteLLM proxy agents reach models through |
| `LOOM_LITELLM_DISCOVERY_BASE_URL` | `litellmDiscoveryBaseUrl` | string | | Where the backend discovers the proxy's models, when it differs |
| `LOOM_LITELLM_PROXY_API_KEY_SECRET_ARN` | `litellmProxyApiKeySecretArn` | string | | Secret holding the proxy's key |
| `LOOM_LITELLM_PROXY_API_KEY_SECRET_KMS_KEY_ARN` | `litellmProxyApiKeySecretKmsKeyArn` | string | | KMS key of that secret, when customer-managed |

## loom-agents

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_ASSISTANT_CODE_PREFIX` | `assistantCodePrefix` | string | `strands_agent/agent.zip` | S3 key of the assistant's code zip in the artifact bucket |
| `LOOM_AGENTS_BEDROCK_MODEL_ARNS` | `agentsBedrockModelArns` | string | | Models the assistant may invoke, comma-separated |
| `LOOM_AGENTS_MEMORY_EVENT_EXPIRY_DAYS` | `agentsMemoryEventExpiryDays` | number | | AgentCore Memory event retention; 30 days on light, 90 on the production tiers when unset |

## loom-agent-role

Read by the `loom-agent-role` Op, one stack per agent
([Create an execution role per agent](/loomster/guides/create-an-execution-role-per-agent/)).

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_AGENT_ROLE_AGENT` | `agentRoleAgent` | string | | The agent the role is for; its credential providers are scoped to `loom-<agent>-*` |
| `LOOM_AGENT_ROLE_GROUP` | `agentRoleGroup` | string | | The `loom:group` the role is registered under in Loom |
| `LOOM_AGENT_ROLE_MEMORY_ARN` | `agentRoleMemoryArn` | string | | Adds the memory policy for this memory |
| `LOOM_AGENT_ROLE_CODE_INTERPRETER` | `agentRoleCodeInterpreter` | boolean | | Adds the Code Interpreter policy |
| `LOOM_AGENT_ROLE_BEDROCK_MODEL_ARNS` | `agentRoleBedrockModelArns` | string | | Models it may invoke, comma-separated; this account's inference profiles and every foundation model when unset |

## loom-tunnel-host

Read by the `loom-tunnel-host` Op. Each is resolved from the stacks when unset
([Open a tunnel to the database](/loomster/guides/open-a-tunnel-to-the-database/)).

| Variable | Parameter | Type | Default | Sets |
|---|---|---|---|---|
| `LOOM_TUNNEL_VPC_ID` | `tunnelVpcId` | string | | VPC for the host; shared-foundation's when unset |
| `LOOM_TUNNEL_SUBNET_IDS` | `tunnelSubnetIds` | string | | Private subnets for the host, comma-separated |
| `LOOM_TUNNEL_DB_SG_ID` | `tunnelDbSecurityGroupId` | string | | The database security group to open to the host |
| `LOOM_TUNNEL_DB_PORT` | `tunnelDbPort` | number | | The database port |
| `LOOM_TUNNEL_INSTANCE_TYPE` | `tunnelInstanceType` | string | | Instance type; `t3.micro` when unset, a Graviton type gets the arm64 image |
| `LOOM_TUNNEL_SSM_ENDPOINTS` | `tunnelSsmEndpoints` | boolean | | Create the `ssm`, `ssmmessages` and `ec2messages` endpoints, for subnets with no NAT |

## Read by Ops and scripts

These aren't build parameters. The Ops and scripts read them when they run:
`LOOM_API_BASE_URL`, `LOOM_API_TOKEN`, `LOOM_SEED_PROFILE`, `LOOM_SEED_GROUP`,
`LOOM_SEED_MODEL_ID`, `LOOM_DEMO_A2A_URL`, `LOOM_UPGRADE_SCRIPTS`,
`LOOM_RESTORE_SNAPSHOT_ID`, `LOOM_RESTORE_TIME`, `LOOM_DR_REGION`,
`LOOM_DR_KMS_KEY_ID`, `LOOM_BACKUP_BUCKET`, `LOOM_IMPORT_SQLITE`,
`LOOM_IMPORT_SKIP_EXISTING`, `LOOM_MEMORY_QUERY`, `LOOM_MEMORY_ID`,
`LOOM_MEMORY_ACTOR_ID`, `LOOM_MEMORY_NAMESPACE`, `LOOM_COGNITO_PASSWORD`,
`LOOM_COGNITO_USERS`, `LOOM_TUNNEL_LOCAL_PORT` and `LOOM_LEDGER_PUSH`. Each is
described on the [Ops](/loomster/reference/ops/) page or the guide for its Op.
