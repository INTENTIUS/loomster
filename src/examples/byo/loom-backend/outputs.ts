/**
 * Named output for the `loom-backend` half of the BYO-everything example
 * (chant#898) — same single key Loom's own `backend/iac/ecs.yaml` exposes,
 * matching the repo's real `../../../loom-backend/outputs.ts`.
 */

import { output } from "@intentius/chant-lexicon-aws";
import { byoBackend as backend } from "./backend";

export const oServiceName = output(backend.service.Name, "oServiceName");
