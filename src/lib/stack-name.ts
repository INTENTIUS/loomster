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
 * `sn()` used to also fall back to reading `process.env` directly, because
 * two chant gaps meant `params.*` couldn't be trusted everywhere `sn()` runs:
 * `chant run --components` — the actual deploy driver every caller of `sn()`
 * (a `*.component.ts` file) runs under — never resolved build-time
 * parameters at all, so `params.*` was always `{}` there regardless of any
 * `env:` mapping (intentius/chant#1108); and `chant build <subdir>` — every
 * `npm run synth:*` script, which is how `../lib/component-stack-names.ts`
 * itself folds — never discovered a repo-root `chant.config.ts`, so its
 * declared `buildParams`/`env:` mappings were silently inert there too
 * (intentius/chant#1117). Both are fixed as of `@intentius/chant@0.23.0`
 * (#1108) and `@0.24.0` (#1117), so `sn()` reads `params.*` only now
 * (loomster#162). The hardcoded defaults below just mirror
 * `chant.config.ts`'s own declared `default`s — a safety net for anything
 * that imports this module outside chant's build pipeline (a unit test),
 * same convention `../loom-agents/params.ts`'s `namingParams` already
 * follows.
 */

import { params } from "@intentius/chant/params";

/** Namespace a component's CFN stack name by project+env+instance. */
export function sn(component: string): string {
  const project = (params.project as string | undefined) ?? "loom";
  const env = (params.env as string | undefined) ?? "dev";
  const instance = (params.instance as string | undefined) ?? "a";
  return `${project}-${env}-${instance}-${component}`;
}
