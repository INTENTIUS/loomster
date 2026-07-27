/**
 * Named outputs for the `loom-db` half of the BYO-everything example
 * (chant#898) — same key set as the repo's real `src/loom-db/outputs.ts`.
 * `data.mode: "reference-existing"` threads the given endpoint/secret ARNs
 * straight through with `literalOutput` — `db.members` is empty (no RDS
 * declarables of its own), so every key here comes from `./params.ts`, not a
 * composite member.
 *
 * `literalOutput(value, name)` rather than a
 * `cond ? output(literalOutputValue(x), name) : undefined` ternary: the
 * reducer that folds this file handles a ternary but has no call case, so a
 * call in the taken branch falls the file back to run (loomster#160). One
 * call, at the export's own top level, is a shape it resolves.
 */

import { literalOutput } from "../../../composites/shared-foundation";
import * as params from "./params";

const data = params.data;
const referenced = data.mode === "reference-existing";

const endpoint = referenced ? data.endpoint : undefined;
const port = referenced ? `${data.port ?? 5432}` : undefined;
const dbName = referenced ? data.dbName ?? "loom" : undefined;
const connectionSecretArn = referenced ? data.connectionSecretArn : undefined;
const credentialsSecretArn = referenced ? data.credentialsSecretArn : undefined;

export const oRdsEndpoint = literalOutput(endpoint, "oRdsEndpoint");
export const oRdsPort = literalOutput(port, "oRdsPort");
export const oRdsDbName = literalOutput(dbName, "oRdsDbName");
export const oConnectEndpoint = literalOutput(endpoint, "oConnectEndpoint");
export const oRdsSecretArn = literalOutput(connectionSecretArn, "oRdsSecretArn");
export const oRdsCredentialsSecretArn = literalOutput(credentialsSecretArn, "oRdsCredentialsSecretArn");
