/**
 * Run Loom's one-time maintenance scripts (`backend/scripts/*.py`) as one-off
 * ECS tasks of the live backend (loomster#5).
 *
 * Loom has no migration tool. Its schema migrates when a new backend task
 * starts (`app.db:init_db` -> `create_all` + `_migrate_add_columns`), so the
 * upgrade Op's "migrate" is just rolling the service. What a release can still
 * ask an operator to run by hand is a script: v1.9.0 ships
 * `migrate_oauth2_secrets.py` (move OAuth2 client secrets into Secrets Manager)
 * and `drop_permission_requests.py`. Upstream's `backend/Dockerfile` copies only
 * `app/` and `etc/`; `scripts/vendor-loom.sh` adds `scripts/` to the image so
 * these can run from the same image the service runs.
 *
 * Each task reuses everything from the running service: the exact task
 * definition revision it runs (image, task role, env, secrets, log config) and
 * its awsvpc network configuration (subnets, security groups). Only the
 * container command is overridden. All of it is resolved at run time with
 * `describe-services`, so nothing about the network has to be passed in.
 *
 * Which scripts to run is a run-time env var (default `LOOM_UPGRADE_SCRIPTS`),
 * read by the shell step, not baked in at `chant build`, the same way
 * `LOOM_RESTORE_TIME` works for `loom-restore`. Format: comma-separated
 * entries, each a script name (with or without `.py`) followed by
 * space-separated args:
 *
 *   LOOM_UPGRADE_SCRIPTS="migrate_oauth2_secrets.py --apply,drop_permission_requests.py --apply"
 *
 * Scripts run as `python -m scripts.<name> [args]` from the image's `/app`
 * workdir. `python scripts/<name>.py` would put `scripts/` first on sys.path
 * and the scripts' own `from app.db import ...` would fail; the module form is
 * also how upstream's docstrings invoke them. Entries run in order; the first
 * non-zero exit fails the step, after printing that task's logs.
 */

export interface BackendTaskTarget {
  cluster: string;
  /** Backend ECS service; its current task definition and network config are reused. */
  serviceName: string;
  /** Container name in the backend task definition (`../../src/composites/loom-backend.ts` names it "backend"). */
  container: string;
}

export function runBackendScriptsScript(target: BackendTaskTarget, envVar = "LOOM_UPGRADE_SCRIPTS"): string {
  const { cluster, serviceName, container } = target;
  const logOpt = (key: string) =>
    `aws ecs describe-task-definition --task-definition "$TASK_DEF" --query "taskDefinition.containerDefinitions[?name=='${container}'] | [0].logConfiguration.options.\\"${key}\\"" --output text`;
  return [
    "set -euo pipefail",
    `SPECS="\${${envVar}:-}"`,
    `if [ -z "$SPECS" ]; then echo "backend-scripts: ${envVar} is empty, nothing to run"; exit 0; fi`,
    `TASK_DEF=$(aws ecs describe-services --cluster "${cluster}" --services "${serviceName}" --query "services[0].taskDefinition" --output text)`,
    `NETWORK=$(aws ecs describe-services --cluster "${cluster}" --services "${serviceName}" --query "services[0].networkConfiguration" --output json)`,
    `if [ -z "$TASK_DEF" ] || [ "$TASK_DEF" = "None" ] || [ "$NETWORK" = "null" ]; then echo "backend-scripts: service ${serviceName} not found in ${cluster}" >&2; exit 1; fi`,
    `LOG_GROUP=$(${logOpt("awslogs-group")})`,
    `LOG_PREFIX=$(${logOpt("awslogs-stream-prefix")})`,
    `IFS=',' read -r -a ENTRIES <<< "$SPECS"`,
    `for ENTRY in "\${ENTRIES[@]}"; do`,
    `  read -r -a WORDS <<< "$ENTRY" || true`,
    `  if [ "\${#WORDS[@]}" -eq 0 ]; then continue; fi`,
    `  NAME="\${WORDS[0]%.py}"`,
    `  if ! [[ "$NAME" =~ ^[A-Za-z0-9_]+$ ]]; then echo "backend-scripts: invalid script name '\${WORDS[0]}'" >&2; exit 1; fi`,
    // argv is built one --arg at a time: jq 1.6 has no `--`, so a script flag
    // like --apply after `--args` would be parsed as a jq option.
    `  ARGV='[]'`,
    `  for ((i = 1; i < \${#WORDS[@]}; i++)); do ARGV=$(jq -c --arg a "\${WORDS[$i]}" '. + [$a]' <<< "$ARGV"); done`,
    `  OVERRIDES=$(jq -cn --arg c "${container}" --arg m "scripts.$NAME" --argjson argv "$ARGV" '{containerOverrides:[{name:$c,command:(["python","-m",$m]+$argv)}]}')`,
    `  echo "backend-scripts: running python -m scripts.$NAME \${WORDS[*]:1} on $TASK_DEF"`,
    `  TASK_ARN=$(aws ecs run-task --cluster "${cluster}" --task-definition "$TASK_DEF" --launch-type FARGATE --network-configuration "$NETWORK" --overrides "$OVERRIDES" --started-by loom-backend-scripts --query "tasks[0].taskArn" --output text)`,
    `  if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then echo "backend-scripts: run-task returned no task for $NAME" >&2; exit 1; fi`,
    `  aws ecs wait tasks-stopped --cluster "${cluster}" --tasks "$TASK_ARN"`,
    `  EXIT_CODE=$(aws ecs describe-tasks --cluster "${cluster}" --tasks "$TASK_ARN" --query "tasks[0].containers[?name=='${container}'] | [0].exitCode" --output text)`,
    `  STOPPED_REASON=$(aws ecs describe-tasks --cluster "${cluster}" --tasks "$TASK_ARN" --query "tasks[0].stoppedReason" --output text)`,
    `  echo "----- $NAME logs ($LOG_GROUP) -----"`,
    `  aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_PREFIX/${container}/\${TASK_ARN##*/}" --start-from-head --query "events[].message" --output json | jq -r '.[]' || echo "(no logs found)"`,
    `  echo "-----"`,
    `  if [ "$EXIT_CODE" != "0" ]; then echo "backend-scripts: $NAME exited $EXIT_CODE ($STOPPED_REASON)" >&2; exit 1; fi`,
    `  echo "backend-scripts: $NAME exited 0"`,
    `done`,
  ].join("\n");
}
