/**
 * loom-agent-role composite (loomster#2).
 *
 * The chant version of Loom's `shared/iac/role.yaml` (pinned v1.9.0): the
 * execution role one Loom agent runs as. Since v1.9.0 (90bbddf) Loom never
 * creates IAM itself — `POST /api/security/roles` only registers a role that
 * already exists, `role_arn` is required on every agent deploy, and Loom's
 * own `make role` stamps out one role stack per agent from that template.
 * This composite stamps out the same role for one named agent, statement for
 * statement, so operators keep one role per agent the way Loom intends (and a
 * per-role kill switch, #16, stops one agent rather than all of them).
 *
 * Policies, named as role.yaml names them:
 * - `bedrock`           — InvokeModel(+WithResponseStream) on the model ARNs.
 * - `bedrock-agentcore` — workload identity on `workload-identity-directory/*`,
 *   and the credential-provider reads scoped to this agent's own
 *   `token-vault/default/{oauth2,apikey}credentialprovider/loom-<agent>-*`
 *   (v1.8.1, H1-3956464: a bare token-vault wildcard let one agent read every
 *   provider in the account).
 * - `secretsmanager`    — `bedrock-agentcore-identity!*` plus this agent's
 *   `loom/agents/<agent>*` and `loom/agents/harness_<agent>*` secrets.
 * - `observability`     — logs/X-Ray, incl. `logs:PutResourcePolicy`, on this
 *   agent's `/aws/bedrock-agentcore/runtimes/<agent>*` log groups.
 * - `memory`            — only when `memoryArn` is set.
 * - `code-interpreter`  — only when `codeInterpreter` is true.
 *
 * Two deliberate differences from role.yaml:
 * - ARNs use `${AWS::Partition}`, not a literal `arn:aws`.
 * - The default inference-profile ARN is this account's
 *   (`bedrock:*:<account>:inference-profile/*`, where system cross-region
 *   profiles live), not role.yaml's default, which names one fixed account.
 *
 * `loomAgentRoleStatements` is exported so shared-foundation's shared agent
 * role (the chant-managed agents and the seed's demo agent run as it) carries
 * the same statements with `agentName: "*"`, i.e. every Loom agent's scope.
 */

import { Composite, mergeDefaults } from "@intentius/chant";
import { Role, Role_Policy, Sub, AWS } from "@intentius/chant-lexicon-aws";
import { loomNaming, type LoomNamingParams } from "../lib/naming";

/** IAM role names are capped at 64 characters. */
const ROLE_NAME_MAX = 64;

export interface LoomAgentRoleStatementOptions {
  /** The Loom agent name the role is scoped to, or `"*"` for every agent (the shared role). */
  agentName: string;
  /** Bedrock model ARNs the agent may invoke. Default: this account's inference profiles + every foundation model. */
  bedrockModelArns?: string[];
  /** Region pattern for AgentCore + Secrets Manager resources (role.yaml `pAgentCoreRegions`). Default: `"*"`. */
  agentCoreRegions?: string;
  /** Region of the runtime log groups (role.yaml `pLogsRegion`). Default: the stack's region. */
  logsRegion?: string;
  /** AgentCore Memory ARN to grant (role.yaml `pMemoryArn`). Unset: no `memory` policy. */
  memoryArn?: string;
  /** Include Code Interpreter sandbox permissions (role.yaml `pEnableCodeInterpreter`). Default: false. */
  codeInterpreter?: boolean;
}

type Statement = Record<string, unknown>;

/** role.yaml's policies by name, as statement lists. `memory`/`code-interpreter` are present only when asked for. */
export type LoomAgentRoleStatements = {
  bedrock: Statement[];
  "bedrock-agentcore": Statement[];
  secretsmanager: Statement[];
  observability: Statement[];
  memory?: Statement[];
  "code-interpreter"?: Statement[];
};

/**
 * Loom v1.9.0 `shared/iac/role.yaml`'s statements for one agent (or, with
 * `agentName: "*"`, for any agent). Plain data — no resource constructors —
 * so both this composite and shared-foundation build their policies from it.
 */
export function loomAgentRoleStatements(o: LoomAgentRoleStatementOptions): LoomAgentRoleStatements {
  const regions = o.agentCoreRegions ?? "*";
  const logsRegion = o.logsRegion ?? AWS.Region;
  // "loom/agents/<agent>*" for one agent; "loom/agents/*" (not "**") for all.
  const agent = o.agentName === "*" ? "" : o.agentName;
  const bedrockModelArns = o.bedrockModelArns ?? [
    Sub`arn:${AWS.Partition}:bedrock:*:${AWS.AccountId}:inference-profile/*`,
    Sub`arn:${AWS.Partition}:bedrock:*::foundation-model/*`,
  ];
  const agentCore = (resource: string) => Sub`arn:${AWS.Partition}:bedrock-agentcore:${regions}:${AWS.AccountId}:${resource}`;
  const secret = (name: string) => Sub`arn:${AWS.Partition}:secretsmanager:${regions}:${AWS.AccountId}:secret:${name}`;
  const runtimeLogs = (prefix: string) =>
    Sub`arn:${AWS.Partition}:logs:${logsRegion}:${AWS.AccountId}:log-group:/aws/bedrock-agentcore/runtimes/${prefix}${agent}*`;
  const providerScope = o.agentName === "*" ? "loom-*" : `loom-${o.agentName}-*`;

  const statements: LoomAgentRoleStatements = {
    bedrock: [{ Effect: "Allow", Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], Resource: bedrockModelArns }],
    "bedrock-agentcore": [
      {
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:CreateWorkloadIdentity",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
        ],
        Resource: [agentCore("workload-identity-directory/*")],
      },
      {
        Effect: "Allow",
        Action: ["bedrock-agentcore:GetApiKeyCredential", "bedrock-agentcore:GetResourceApiKey", "bedrock-agentcore:GetResourceOauth2Token"],
        Resource: [
          agentCore(`token-vault/default/oauth2credentialprovider/${providerScope}`),
          agentCore(`token-vault/default/apikeycredentialprovider/${providerScope}`),
        ],
      },
    ],
    secretsmanager: [
      {
        Effect: "Allow",
        Action: "secretsmanager:GetSecretValue",
        Resource: [secret("bedrock-agentcore-identity!*"), secret(`loom/agents/${agent}*`), secret(`loom/agents/harness_${agent}*`)],
      },
    ],
    observability: [
      { Effect: "Allow", Action: ["logs:DescribeLogGroups", "xray:PutTelemetryRecords", "xray:PutTraceSegments"], Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:PutLogEvents",
          "logs:PutResourcePolicy",
        ],
        Resource: [runtimeLogs(""), runtimeLogs("harness_")],
      },
    ],
  };
  if (o.memoryArn) {
    statements.memory = [
      {
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetMemory",
          "bedrock-agentcore:GetMemoryRecord",
          "bedrock-agentcore:ListActors",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:ListSessions",
          "bedrock-agentcore:RetrieveMemoryRecords",
        ],
        Resource: o.memoryArn,
      },
    ];
  }
  if (o.codeInterpreter) {
    statements["code-interpreter"] = [
      {
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:CreateCodeInterpreter",
          "bedrock-agentcore:DeleteCodeInterpreter",
          "bedrock-agentcore:GetCodeInterpreter",
          "bedrock-agentcore:ListCodeInterpreters",
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:GetCodeInterpreterSession",
          "bedrock-agentcore:ListCodeInterpreterSessions",
        ],
        Resource: [
          Sub`arn:${AWS.Partition}:bedrock-agentcore:${regions}:aws:code-interpreter/*`,
          agentCore("code-interpreter/*"),
          agentCore("code-interpreter-custom/*"),
        ],
      },
    ];
  }
  return statements;
}

/** The trust policy role.yaml uses: AgentCore, confined to this account. */
export const AGENTCORE_ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "bedrock-agentcore.amazonaws.com" },
      Action: "sts:AssumeRole",
      // A Sub, not a bare Ref: the same value, and template checks that only
      // know declared logical ids (src/examples/byo/adoption.test.ts) accept it.
      Condition: { StringEquals: { "aws:SourceAccount": Sub`${AWS.AccountId}` } },
    },
  ],
};

export interface LoomAgentRoleProps extends Omit<LoomAgentRoleStatementOptions, "agentName"> {
  /** Naming/tagging parameter source (chant#897). */
  naming: LoomNamingParams;
  /** The Loom agent this role is for, exactly as it is named in Loom (role.yaml `pAgentName`). */
  agentName: string;
  /** `loom:group` tag — the Loom group whose members may deploy with this role (role.yaml `pTagGroup`). */
  group: string;
  /** `loom:application` tag. Default: `"loomster"` (what the seed brands everything with). */
  application?: string;
  /** `loom:owner` tag. Default: the naming params' owner. */
  owner?: string;
  /** Per-member CloudFormation prop overrides, merged over this composite's defaults. */
  defaults?: { role?: Partial<ConstructorParameters<typeof Role>[0]> };
}

export type LoomAgentRoleResult = { role: InstanceType<typeof Role> };

export const LoomAgentRole = Composite<LoomAgentRoleProps, LoomAgentRoleResult>((props) => {
  const naming = loomNaming(props.naming, "agent-role");
  // role.yaml's pRoleSuffix: the agent name with underscores as hyphens.
  const suffix = props.agentName.replace(/_/g, "-");
  const roleName = naming.name(suffix);
  const tooLongError = new Error(`LoomAgentRole: role name "${roleName}" is over ${ROLE_NAME_MAX} characters; shorten the agent name or the naming segments`);
  if (roleName.length > ROLE_NAME_MAX) throw tooLongError;

  const statements = loomAgentRoleStatements({ ...props, agentName: props.agentName });
  const policies = Object.entries(statements).map(
    ([name, statement]) =>
      new Role_Policy({
        PolicyName: naming.name(`${suffix}-${name}`),
        PolicyDocument: { Version: "2012-10-17", Statement: statement } as unknown as string,
      }),
  );

  const tags = [
    ...Object.entries(naming.tags()).map(([Key, Value]) => ({ Key, Value })),
    { Key: "loom:application", Value: props.application ?? "loomster" },
    { Key: "loom:group", Value: props.group },
    { Key: "loom:owner", Value: props.owner ?? props.naming.owner },
  ];

  const role = new Role(mergeDefaults({
    RoleName: roleName,
    Path: "/",
    AssumeRolePolicyDocument: AGENTCORE_ASSUME_ROLE_POLICY,
    Policies: policies,
    Tags: tags,
  }, props.defaults?.role));

  return { role };
}, "LoomAgentRole");
