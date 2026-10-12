/**
 * Credentials Op (loomster#39) — Loom's `make agentcore.credentials.list`,
 * read-only:
 *
 *   chant run loom-credentials
 *
 * Two lists: every OAuth2 and API-key credential provider in the region, as
 * upstream prints, and the ones THIS Loom recorded in its database (the set
 * `loom-credentials-delete` and `loom-teardown` delete). Provider names carry
 * no deployment marker, so the second list is the only way to tell this
 * instance's providers from another Loom's in the same account.
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { operatorRefs, listCredentialProvidersScript, ownedCredentialProvidersScript } from "./lib/operator";

const naming = namingParamsFromEnv();
const refs = operatorRefs(naming);

export default Op({
  name: "loom-credentials",
  overview: `List AgentCore credential providers (env=${naming.env}, instance=${naming.instance}): every one in the region, then the ones this Loom recorded. Read-only, ungated.`,
  labels: { Env: naming.env },
  phases: [
    phase("Account", [shell(listCredentialProvidersScript(), { profile: "fastIdempotent" })]),
    phase("Owned", [shell(ownedCredentialProvidersScript(refs.backend, "list"), { profile: "longInfra" })]),
  ],
});
