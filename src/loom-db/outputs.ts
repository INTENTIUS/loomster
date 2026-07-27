/**
 * Named outputs for the `loom-db` stack (chant#887) — the exact key set
 * Loom's own `backend/iac/rds.yaml` exposes, so #889 (the backend ECS
 * service) resolves them by the same convention:
 * `stackOutput("loom-db", "<key>")`. The backend reads `oConnectEndpoint`
 * and `oRdsCredentialsSecretArn`.
 *
 * Which of these actually exist depends on `data.mode` (chant#898) and the
 * tier — `loomDbOutputs` in `./output-set.ts` holds that decision, and its
 * header explains why it is a function call here rather than the ternaries
 * this file used to spell inline (loomster#160).
 */

import { db } from "./db";
import * as params from "./params";
import { loomDbOutputs } from "./output-set";

export const {
  oRdsEndpoint,
  oRdsPort,
  oRdsDbName,
  oProxyEndpoint,
  oConnectEndpoint,
  oSecretsKmsKeyArn,
  oRdsSecretArn,
  oRdsCredentialsSecretArn,
} = loomDbOutputs(db, params);
