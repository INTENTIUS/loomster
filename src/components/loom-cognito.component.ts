import { phase, type Component } from "@intentius/chant/components";
import { loomCognitoStackName } from "../lib/component-stack-names";

/**
 * The `loom-cognito` identity stack (chant#888) — Cognito UserPool, hosted-UI
 * domain, resource server (21-scope catalog on full tier), M2M client, and
 * (production/production-ha) user client + RBAC groups + Managed Login
 * branding. `infra` archetype — no build, just apply. The template is what
 * `chant build src/loom-cognito --lexicon aws` synthesizes from
 * `../composites/loom-cognito.ts`.
 *
 * No VPC/network dependency — Cognito is a regional, account-level service —
 * so unlike `loom-db` this has nothing to thread in from `shared-foundation`
 * and can deploy independently. Named outputs (`../loom-cognito/outputs.ts`)
 * are what #889 (the frontend/backend services) attach to via
 * `stackOutput("loom-cognito", ...)`.
 */
export const loomCognito: Component = {
  name: "loom-cognito",
  archetype: "infra",
  dependsOn: [],
  deploy: [
    // Synthesize this stack's template on the deploy path. cfn-deploy reads
    // `dist/loom-cognito.template.json` from disk and `chant run --components`
    // never builds it, so without this phase a deploy applies whatever stale
    // template is lying in dist/ (or fails in a fresh checkout). The build
    // reads the LOOM_* env vars the run was started with
    // (test/claims/params/reach-deploy.sh).
    phase("Synth", [
      {
        kind: "shell",
        cmd: "npm run -s synth:loom-cognito",
        reason: "synthesize dist/loom-cognito.template.json from the run's build params before cfn-deploy reads it; no verb builds a lexicon stack inside a component run",
      },
    ]),
    phase("Apply", [
      { kind: "cfn-deploy", stack: loomCognitoStackName, template: "dist/loom-cognito.template.json" },
    ]),
  ],
};
