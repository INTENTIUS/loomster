/**
 * Named outputs for the `loom-backend` stack (chant#889) — the exact key
 * Loom's own `backend/iac/ecs.yaml` exposes: `oServiceName`, used by
 * `ecs-update-service`/`wait-steady-state` (see
 * `../components/loom-backend.component.ts`).
 */

import { output } from "@intentius/chant-lexicon-aws";
import { backend } from "./backend";

export const oServiceName = output(backend.service.Name, "oServiceName");
