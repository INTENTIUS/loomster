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
 *
 * chant#157 — inputs are chant build-time parameters (`params.project`/
 * `params.env`/`params.instance`, declared in `../../chant.config.ts`'s
 * `buildParams`, each with an `env:` mapping back to this file's original
 * `LOOM_PROJECT`/`LOOM_ENV`/`LOOM_INSTANCE` vars), not a bare `process.env`
 * read — so `chant build --fold` can resolve a `sn(...)` call to a plain
 * string without executing this file's own top-level statements (see
 * `../lib/component-stack-names.ts`, which is what actually makes that
 * happen: `sn(...)` still can't fold as a nested call INSIDE a `Component`
 * object literal, only as another file's own top-level `export const`).
 *
 * That parity holds for `chant build` — the CLI resolves `buildParams`
 * (`--param`/`--params-file`/a declared `env:` mapping/its `default`) and
 * populates `params.*` before any project file loads. It does NOT hold for
 * `chant run --components` — the actual deploy driver every caller of `sn()`
 * (a `*.component.ts` file) runs under. That command's component discovery
 * (`discoverComponents`) never resolves or sets build-time parameters, so
 * `params.*` is always `{}` there — confirmed empirically, not assumed: a
 * probe script importing `@intentius/chant/params` after `discoverComponents`
 * ran showed an empty object even with `LOOM_ENV`/`LOOM_INSTANCE` exported.
 * Without a fallback, a `params.*`-only `sn()` would silently ignore
 * `LOOM_PROJECT`/`LOOM_ENV`/`LOOM_INSTANCE` at every REAL deploy — every
 * `chant run --components` invocation would compute every stack name from
 * this file's hardcoded defaults, no matter what a CI job or
 * `test/production-live-e2e.sh` (which deploys to real AWS with
 * `LOOM_ENV=prod` by default) actually sets. So each segment below prefers
 * `params.<name>` (correct and pure under `chant build`) and falls back to
 * the original env var (correct under `chant run --components`, where
 * `params.<name>` is always `undefined`) before the final hardcoded default.
 * Filed as intentius/chant#1108 — once component discovery resolves
 * build-time parameters the same way `chant build` does, the env-var
 * fallback here can be deleted.
 */

import { params } from "@intentius/chant/params";

/** `params.<name>` when the CLI populated it (a real `chant build`); the original env var otherwise (`chant run --components`, a test importing this file directly, …); the hardcoded default last. */
function segment(paramValue: unknown, envVar: string, fallback: string): string {
  if (typeof paramValue === "string") return paramValue;
  return process.env[envVar] ?? fallback;
}

/** Namespace a component's CFN stack name by project+env+instance. */
export function sn(component: string): string {
  const project = segment(params.project, "LOOM_PROJECT", "loom");
  const env = segment(params.env, "LOOM_ENV", "dev");
  const instance = segment(params.instance, "LOOM_INSTANCE", "a");
  return `${project}-${env}-${instance}-${component}`;
}
