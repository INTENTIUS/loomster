/**
 * Precomputed per-stack CFN stack names (chant#157).
 *
 * `sn(component)` (`./stack-name.ts`) cannot fold when called INLINE inside a
 * `*.component.ts` file's exported `Component` object literal — chant's fold
 * engine has exactly two allowlisted call-expression shapes it will reduce
 * without executing anything (`phase(...)`/`output(...)`-style registered
 * chant helpers, and a lexicon intrinsic like `Ref(...)` whose lexicon opted
 * its call form in), and `sn` is neither. Every other call nested inside an
 * object literal — a user function, a method call — is structurally
 * unrepresentable there and always throws "function call as a value is not
 * foldable" (`@intentius/chant`'s `fold()`, `packages/core/src/fold/fold.ts`).
 *
 * A bare call IS resolvable, though, when it is a file's OWN top-level
 * `export const` initializer: chant's cross-file resolution
 * (`../discovery/fold-import.ts`'s `resolveCallExpression`) requires only
 * that the callee be a plain identifier bound by that file's own `import` —
 * no allowlist — imports the real module, and invokes the real function for
 * real, exactly as the run path would. So each `sn(...)` call gets hoisted
 * into its own top-level export HERE, in a file with no other declaration —
 * this file folds to plain strings, and a `*.component.ts` file importing one
 * of these constants resolves it as an ordinary cross-file value (chant#1020),
 * not as a call at all.
 *
 * Every name here is deployment-agnostic where it's declared (this file has
 * no `Component`s of its own) and deployment-SPECIFIC where it's evaluated —
 * `sn()`'s own doc (`./stack-name.ts`) covers the build-time-parameter vs.
 * `chant run --components` distinction that governs what value each constant
 * actually holds at any given invocation.
 */

import { sn } from "./stack-name";

export const sharedFoundationStackName = sn("shared-foundation");
export const downstreamStubStackName = sn("downstream-stub");
export const loomDbStackName = sn("loom-db");
export const loomCognitoStackName = sn("loom-cognito");
export const loomBackendStackName = sn("loom-backend");
export const loomFrontendStackName = sn("loom-frontend");
export const loomAgentsStackName = sn("loom-agents");
