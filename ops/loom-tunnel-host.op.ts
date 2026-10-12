/**
 * Tunnel-host Op (loomster#37) — the chant version of Loom's `make ec2`
 * (`backend/iac/ec2.yaml`): an SSM-only EC2 host in a private subnet, the
 * way into a private database. Off unless an operator runs this; the stack
 * is not a component, so `chant run --components all` never deploys it.
 *
 *   chant run loom-tunnel-host                     # or: just tunnel-host
 *   LOOM_TUNNEL_SSM_ENDPOINTS=true chant run loom-tunnel-host   # no NAT in the private subnets
 *
 * One phase: deploy `{project}-{env}-{instance}-tunnel-host`, wired to the
 * VPC, private subnets and database security group read from
 * shared-foundation's and loom-db's outputs (`./lib/tunnel-host.ts`).
 * Idempotent and ungated. The tunnel itself is `just tunnel`
 * (`scripts/tunnel.sh`), not an Op: a port-forward session runs until the
 * operator stops it, which is nothing to record on the lifecycle ledger.
 * `loom-teardown` deletes the host first, before the stacks it sits on.
 */

import { Op, phase, shell } from "@intentius/chant/op";
import { namingParamsFromEnv } from "./lib/naming-env";
import { deployTunnelHostScript, TUNNEL_HOST_STACK } from "./lib/tunnel-host";

const naming = namingParamsFromEnv();
const refs = { stackPrefix: `${naming.project}-${naming.env}-${naming.instance}` };

export default Op({
  name: "loom-tunnel-host",
  overview: `Deploy the optional SSM tunnel host (Loom's ec2.yaml) as ${refs.stackPrefix}-${TUNNEL_HOST_STACK} (env=${naming.env}) into shared-foundation's private subnets, with ingress to loom-db's security group. Idempotent, ungated, local executor; open the tunnel with \`just tunnel\`.`,
  labels: { Env: naming.env },
  phases: [phase("Deploy", [shell(deployTunnelHostScript(refs), { profile: "longInfra" })])],
});
