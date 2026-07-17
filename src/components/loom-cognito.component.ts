import { phase, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";

/**
 * The `loom-cognito` identity stack (chant#888) — Cognito UserPool, hosted-UI
 * domain, resource server (23-scope catalog on full tier), M2M client, and
 * (production/production-ha) user client + RBAC groups + Managed Login
 * branding. `infra` archetype — no build, just apply. The template is what
 * `chant build src/loom-cognito --lexicon aws` synthesizes from
 * `../composites/loom-cognito.ts`.
 *
 * No VPC/network dependency — Cognito is a regional, account-level service —
 * so unlike `loom-db` this has nothing to thread in from `shared-foundation`
 * and can deploy independently. Named outputs (`../loom-cognito/outputs.ts`)
 * are what #889 (the frontend/backend services) attach to via
 * `stackOutput(sn("loom-cognito"), ...)`.
 */
export const loomCognito: Component = {
  name: "loom-cognito",
  archetype: "infra",
  dependsOn: [],
  deploy: [
    phase("Apply", [
      { kind: "cfn-deploy", stack: sn("loom-cognito"), template: "dist/loom-cognito.template.json" },
    ]),
  ],
};
