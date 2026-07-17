/**
 * CloudFormation stack-name namespacing (loomster#140).
 *
 * loomster's physical resource names already carry the deployment's
 * `{project}-{env}-{instance}` prefix (see `./naming.ts`), so N Loom instances can
 * coexist in one AWS account or across many. The CFN *stack* names have to follow
 * the same convention or two deployments collide on `shared-foundation`,
 * `loom-db`, etc. — even though every resource inside them is uniquely named.
 *
 * `sn("shared-foundation")` → `"loom-prod-a-shared-foundation"`. Every component's
 * `stack:` (the stack it deploys) and every cross-stack `stackOutput(...)` key on
 * this same function, so a second instance (`LOOM_INSTANCE=b`) or environment
 * (`LOOM_ENV=staging`) deploys a fully separate, non-colliding set of stacks.
 *
 * The component `name`/`dependsOn` graph identifiers stay the short component names
 * (`"shared-foundation"`) — only the AWS-facing stack names are namespaced.
 */

const PROJECT = process.env.LOOM_PROJECT ?? "loom";
const ENV = process.env.LOOM_ENV ?? "dev";
const INSTANCE = process.env.LOOM_INSTANCE ?? "a";

/** Namespace a component's CFN stack name by project+env+instance. */
export function sn(component: string): string {
  return `${PROJECT}-${ENV}-${INSTANCE}-${component}`;
}
