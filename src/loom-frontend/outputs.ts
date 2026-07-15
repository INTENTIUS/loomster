/**
 * Named outputs for the `loom-frontend` stack (chant#889) — the exact key
 * Loom's own `frontend/iac/ecs.yaml` exposes: `oServiceName`, used by
 * `ecs-update-service`/`wait-steady-state` (see
 * `../components/loom-frontend.component.ts`).
 */

import { output } from "@intentius/chant-lexicon-aws";
import { frontend } from "./frontend";

export const oServiceName = output(frontend.service.Name, "oServiceName");
