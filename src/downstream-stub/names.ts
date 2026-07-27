/**
 * Precomputed SSM parameter names for `./stub.ts` (loomster#160).
 *
 * Same shape, and the same reason, as `../lib/component-stack-names.ts`: a
 * call used as a value INSIDE a resource constructor's props object is
 * folded by chant's general reducer (`fold()`), which has no call case at
 * all — a call there always throws "function call as a value is not
 * foldable", and hoisting it to a `const` in the same file changes nothing,
 * because the reducer just follows the identifier to the same call node.
 *
 * A bare call IS resolvable when it is a file's own top-level `export const`
 * initializer and its callee is a plain identifier bound by that file's
 * `import`s: chant resolves the import, invokes the real function with
 * statically-folded arguments, and records the result — the same mechanism a
 * composite factory call uses. So the names live here, one export each, and
 * `./stub.ts` reads them as ordinary cross-file constants.
 *
 * `loomName` (rather than `loomNaming(...).name(...)`) for the second half of
 * the same constraint: the callee has to be an identifier, and a method call
 * is a property-access callee.
 */

import { loomName } from "../lib/naming";
import { namingParams } from "../shared-foundation/params";

export const ecsClusterArnEchoName = loomName(namingParams, "downstream-stub", "ecs-cluster-arn");
export const httpsListenerArnEchoName = loomName(namingParams, "downstream-stub", "https-listener-arn");
export const frontendTargetGroupArnEchoName = loomName(namingParams, "downstream-stub", "frontend-target-group-arn");
export const backendTargetGroupArnEchoName = loomName(namingParams, "downstream-stub", "backend-target-group-arn");
export const frontendRepositoryUriEchoName = loomName(namingParams, "downstream-stub", "frontend-repository-uri");
export const backendRepositoryUriEchoName = loomName(namingParams, "downstream-stub", "backend-repository-uri");
export const albSecurityGroupIdEchoName = loomName(namingParams, "downstream-stub", "alb-security-group-id");
export const ecsSecurityGroupIdEchoName = loomName(namingParams, "downstream-stub", "ecs-security-group-id");
