/**
 * Cognito set-passwords Op (loomster#39) — Loom's `make
 * cognito.set-passwords`: give users a permanent password so their first
 * sign-in skips the forced change. Upstream sets its 22 demo users from
 * `etc/environment.sh`; here:
 *
 *   LOOM_COGNITO_PASSWORD='...' chant run loom-cognito-set-passwords                       # every FORCE_CHANGE_PASSWORD user
 *   LOOM_COGNITO_USERS=alice,bob LOOM_COGNITO_PASSWORD='...' chant run loom-cognito-set-passwords
 *
 * The pool id comes from the loom-cognito stack's `oCognitoUserPoolId`
 * output; the password never reaches argv (`./lib/operator.ts`). Ungated but
 * never over MCP: passwords are for people to set.
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { preflightPhase, stackPrefixOf } from "./lib/preflight";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, setPasswordsScript } from "./lib/operator";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-cognito-set-passwords",
  overview: `Set a permanent Cognito password (LOOM_COGNITO_PASSWORD) for LOOM_COGNITO_USERS, or every user still in FORCE_CHANGE_PASSWORD (env=${naming.env}, instance=${naming.instance}). Never over MCP.`,
  labels: { Env: naming.env },
  neverOverMcp: true,
  phases: [
    preflightPhase({ env: naming.env, stacks: ["loom-cognito"].map((c) => `${stackPrefixOf(naming)}-${c}`) }),
    phase("SetPasswords", [shell(setPasswordsScript(refs.cognitoStackName), { profile: "fastIdempotent" })]),
  ],
});
