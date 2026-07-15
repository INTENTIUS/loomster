/**
 * Physical resource identifiers a lifecycle Op needs, derived from the same
 * naming helper every composite uses (`../../src/lib/naming.ts`, chant#897) —
 * never a second, hand-copied literal.
 *
 * An Op step's `args` are static JSON baked in at `chant build` time (see
 * `docs/guide/ops.mdx` — an `ActivityStep` has no `@Phase.field`-style wiring the
 * way a Component step does), so a lifecycle Op cannot resolve a cross-stack
 * `stackOutput(...)` the way `../../src/components/*.component.ts` do. Every
 * identifier below is instead something the naming helper already makes
 * deterministic — the same resource name the owning composite gives the physical
 * resource — so an AWS CLI lookup by that name (`--query "...[?Name=='<name>']"`)
 * stands in for the stack-output wiring a Component gets for free. The one
 * genuinely opaque, AWS-generated id (the Cognito User Pool id) is resolved this
 * same way: looked up by its deterministic `UserPoolName` at run time
 * (`../lib/rotation.ts`), never hardcoded or threaded through an env var.
 */

import { loomNaming, type LoomNamingParams } from "../../src/lib/naming";

export interface LoomStackRefs {
  /** RDS DB instance identifier (`../../src/composites/loom-db.ts`'s `dbInstanceIdentifier`). */
  dbInstanceIdentifier: string;
  /** Secrets Manager secret name for the RDS master credentials (loom-db's `RdsCredentialsSecret`). */
  credentialsSecretName: string;
  /** Secrets Manager secret name for the SQLAlchemy connection URL (loom-db's `RdsConnectionSecret`). */
  connectionSecretName: string;
  /** ECS cluster name (shared-foundation). */
  ecsClusterName: string;
  /** Backend ECS service name (loom-backend). */
  backendServiceName: string;
  /** Frontend ECS service name (loom-frontend). */
  frontendServiceName: string;
  /** Backend ECS task-definition family — `run-migration`'s `ecs-task` target runs the backend's own image against this family, overriding its command (chant#905's "no rebuild in the upgrade path": same image, different entrypoint). */
  backendTaskFamily: string;
  /** Cognito user pool name (loom-cognito) — the pool id itself is AWS-generated and opaque; looked up by this deterministic name at run time. */
  cognitoUserPoolName: string;
  /** Cognito M2M app-client name (loom-cognito) — rotated blue/green (`../lib/rotation.ts`) since Cognito has no in-place "regenerate client secret" API. */
  cognitoM2mClientName: string;
  /** Secrets Manager secret the rotation writes the replacement M2M client's `{clientId,clientSecret}` into, for downstream consumers to pick up before the old client is deleted. */
  cognitoM2mReplacementSecretName: string;
  /** ALB name (shared-foundation) — `../lib/rotation.ts`'s ACM rotation resolves the load balancer/listener ARNs from this at run time (both are AWS-generated). */
  albName: string;
  /** RDS Proxy name (loom-db, `production`/`production-ha` only) — `../lib/rotation.ts`'s manual RDS rotation resolves the proxy's endpoint from this at run time. */
  rdsProxyName: string;
}

/** Derive every physical identifier a lifecycle Op needs from one naming-params source — the Op-layer counterpart to each composite's own `loomNaming(...)` call. */
export function stackRefs(naming: LoomNamingParams): LoomStackRefs {
  const db = loomNaming(naming, "loom-db");
  const backend = loomNaming(naming, "loom-backend");
  const frontend = loomNaming(naming, "loom-frontend");
  const sharedFoundation = loomNaming(naming, "shared-foundation");
  const cognito = loomNaming(naming, "loom-cognito");

  return {
    dbInstanceIdentifier: db.name("instance", { service: "rdsInstance" }),
    credentialsSecretName: db.name("credentials"),
    connectionSecretName: db.name("database-url"),
    ecsClusterName: sharedFoundation.name("cluster"),
    backendServiceName: backend.name("backend-svc"),
    frontendServiceName: frontend.name("frontend-svc"),
    backendTaskFamily: backend.name("backend-task"),
    cognitoUserPoolName: cognito.name("pool"),
    cognitoM2mClientName: cognito.name("m2m-client"),
    cognitoM2mReplacementSecretName: cognito.name("m2m-client-rotated"),
    albName: sharedFoundation.name("alb", { service: "alb" }),
    rdsProxyName: db.name("proxy", { service: "rdsProxy" }),
  };
}
