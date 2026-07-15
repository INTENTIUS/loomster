/**
 * Named outputs for the `loom-db` half of the BYO-everything example
 * (chant#898) — same key set as the repo's real `src/loom-db/outputs.ts`.
 * `data.mode: "reference-existing"` threads the given endpoint/secret ARNs
 * straight through with `literalOutputValue` — `db.members` is empty (no
 * RDS declarables of its own), so every key here comes from `./params.ts`,
 * not a composite member.
 */

import { output } from "@intentius/chant-lexicon-aws";
import { literalOutputValue } from "../../../composites/shared-foundation";
import * as params from "./params";

const data = params.data;

export const oRdsEndpoint = data.mode === "reference-existing" ? output(literalOutputValue(data.endpoint), "oRdsEndpoint") : undefined;

export const oRdsPort = data.mode === "reference-existing"
  ? output(literalOutputValue(`${data.port ?? 5432}`), "oRdsPort")
  : undefined;

export const oRdsDbName = data.mode === "reference-existing"
  ? output(literalOutputValue(data.dbName ?? "loom"), "oRdsDbName")
  : undefined;

export const oConnectEndpoint = data.mode === "reference-existing" ? output(literalOutputValue(data.endpoint), "oConnectEndpoint") : undefined;

export const oRdsSecretArn = data.mode === "reference-existing" && data.connectionSecretArn
  ? output(literalOutputValue(data.connectionSecretArn), "oRdsSecretArn")
  : undefined;

export const oRdsCredentialsSecretArn = data.mode === "reference-existing"
  ? output(literalOutputValue(data.credentialsSecretArn), "oRdsCredentialsSecretArn")
  : undefined;
