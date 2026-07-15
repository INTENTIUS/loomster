/**
 * Named output for the `loom-frontend` half of the BYO-everything example
 * (chant#898) — same single key Loom's own `frontend/iac/ecs.yaml` exposes,
 * matching the repo's real `../../../loom-frontend/outputs.ts`.
 */

import { output } from "@intentius/chant-lexicon-aws";
import { frontend } from "./frontend";

export const oServiceName = output(frontend.service.Name, "oServiceName");
