import { Op, phase, gate, shell, stepOutput } from "@intentius/chant/op";
import { deployment } from "../deployment";

// `yodel apply <deployment>` runs this Op (scripts/db/yodel.sh apply, and the
// upgrade Op's Schema phase). The gate is bound to the plan digest: the
// pending migrations' checksums, the history and the live schema, so an
// approval given for one state never applies another, and one given for
// loom-dev-a never counts for loom-prod-a. `just db approve` approves it at a
// terminal.
const plan = shell(`yodel apply ${deployment} --digest`, { id: "plan" });
const digest = stepOutput(plan, "stdout");

export const op = Op({
  name: `migrate-${deployment}`,
  overview: `Apply the pending migrations of Loom's schema to ${deployment}, behind an approval bound to their plan digest`,
  phases: [
    phase("Plan", [plan]),
    phase("Approve", [gate(`approve-migrate-${deployment}`, { plan: digest })]),
    phase("Apply", [shell(`yodel apply ${deployment} --execute`, { env: { YODEL_APPROVED_PLAN: digest }, timeout: "2h" })]),
  ],
});
