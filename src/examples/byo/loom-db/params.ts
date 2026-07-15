/**
 * "Bring-your-own-everything" adoption example (chant#898) — the `loom-db`
 * half. `data.mode: "reference-existing"` points the backend at an external
 * Postgres endpoint (an existing RDS instance, Aurora cluster, or any
 * Postgres-compatible service the data team already runs) this stack does
 * not own — `chant build src/examples/byo/loom-db --lexicon aws` creates no
 * RDS instance, subnet group, security group, KMS key, or secret.
 *
 * Values below are illustrative placeholders. Zero edits to
 * `../../../composites/loom-db.ts`.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type { DataSeam } from "../../../composites/loom-db";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "shared-a",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

/**
 * An externally-managed Postgres endpoint — the data team's own RDS/Aurora
 * instance, already backed up, patched, and monitored under its own
 * lifecycle, outside this Loom instance's stacks entirely. The two secret
 * ARNs point at Secrets Manager secrets the data team also owns and rotates;
 * this composite reads them (via `loom-backend`'s `pDatabaseSecretArn`
 * input) but never writes to them.
 */
export const data: DataSeam = {
  mode: "reference-existing",
  endpoint: "loom-shared.cluster-abcdefghijkl.us-east-1.rds.amazonaws.com",
  port: 5432,
  dbName: "loom",
  credentialsSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:data-team/loom-rds-credentials-AbCdEf",
  connectionSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:data-team/loom-database-url-GhIjKl",
};
