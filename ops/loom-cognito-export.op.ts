/**
 * Cognito user-export Op — a backup of the one thing a re-synth can't restore:
 * the user records. The pool's configuration (groups, clients, resource
 * server, scopes) is in code; the users are not. This exports users, groups,
 * and per-group memberships to stdout, and to S3 when `LOOM_BACKUP_BUCKET` is
 * set.
 *
 *   chant run loom-cognito-export
 *   LOOM_BACKUP_BUCKET=my-bucket chant run loom-cognito-export   # + writes to S3
 *
 * Read-only and additive, so this runs on the local executor with no gate,
 * tier-agnostic like `../loom-backup.op.ts`.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";
import { namingParamsFromEnv } from "./lib/naming-env";
import { stackRefs } from "./lib/stack-refs";
import { cognitoUserExportScript } from "./lib/cognito-backup";

const naming = namingParamsFromEnv();
const refs = stackRefs(naming);

export default Op({
  name: "loom-cognito-export",
  overview: `Export the Cognito user pool's users, groups, and memberships for the Loom deployment (env=${naming.env}, instance=${naming.instance}) — to stdout, and to S3 when LOOM_BACKUP_BUCKET is set. Read-only, ungated, local executor.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { Env: naming.env, Backup: "true" },
  phases: [
    phase("Export", [shell(cognitoUserExportScript({ cognitoUserPoolName: refs.cognitoUserPoolName }), { profile: "longInfra" })]),
  ],
});
