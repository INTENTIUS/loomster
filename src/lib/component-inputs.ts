/**
 * Precomputed deploy-time inputs for the `*.component.ts` files (loomster#160).
 *
 * Same shape and the same reason as `./component-stack-names.ts`: a call used
 * as a value inside a `Component` object literal is reduced by chant's general
 * reducer, which has no call case, and hoisting it to a `const` in the same
 * file changes nothing — the reducer follows the identifier straight back to
 * the same call node. A bare call IS resolvable as a file's own top-level
 * `export const` initializer, so each read gets one here and each component
 * file imports the constant.
 *
 * Every value below used to be an ambient `process.env` read in the component
 * file itself, which is the one thing chant's fold path refuses on purpose: an
 * environment read is a value it could only get by executing the file. Each is
 * now a declared build-time parameter (`../../chant.config.ts`), read as
 * `params.<name>` directly — nothing that sets `LOOM_HARNESS_AGENT_IMAGE_URI`,
 * `LOOM_DOMAIN_NAME` or `AWS_ENDPOINT_URL` today behaves differently, since
 * each still has its own declared `env:` mapping there.
 *
 * These used to be read through a hand-rolled `paramOrEnv`/`paramOrEnvOr`
 * (declared value first, the raw env var second) because `chant run
 * --components` — the command every one of these values is actually read
 * under — never resolved build-time parameters at all
 * (intentius/chant#1108). Fixed as of `@intentius/chant@0.23.0`, so
 * `params.*` alone is enough now (loomster#162).
 */

import { params } from "@intentius/chant/params";
import { loomName } from "./naming";
import { namingParams as backendNamingParams } from "../loom-backend/params";
import { namingParams as frontendNamingParams } from "../loom-frontend/params";

/**
 * A caller's own harness container image, threaded to `loom-agents`'s CFN
 * parameter. Unset (the default) means the composite emits no harness Runtime
 * (loomster#128).
 */
export const harnessAgentImageUri = (params.harnessAgentImageUri as string | undefined) ?? "";

/**
 * The AWS endpoint override a local emulator sets (Floci sets
 * `AWS_ENDPOINT_URL`). Present means this invocation targets an emulator, not
 * real AWS — `loom-backend`/`loom-frontend` skip their runtime Verify phases
 * there, since an emulator deploys the control plane but does not serve the
 * ALB->ECS HTTP data path (verified live, loomster#37).
 */
export const awsEndpointUrl = params.awsEndpointUrl as string | undefined;

/**
 * The custom domain the full tiers serve HTTPS-only on (the prod ALB has no
 * HTTP listener), so a health-gate must probe `https://<domain>` rather than
 * the ALB's own DNS name (loomster#125).
 */
export const domainName = params.domainName as string | undefined;

/**
 * ECS service names, the one place a component needs a physical resource name.
 * Free-function `loomName` rather than `loomNaming(...).name(...)` because a
 * method call has a property-access callee chant cannot resolve, and here
 * rather than in the component file because a call is only resolvable as a
 * file's own top-level `export const` initializer. Each derives the identical
 * string its composite set as the service's `ServiceName` prop.
 */
export const backendServiceName = loomName(backendNamingParams, "loom-backend", "backend-svc");
export const frontendServiceName = loomName(frontendNamingParams, "loom-frontend", "frontend-svc");
