import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { downstreamStubStackName } from "../lib/component-stack-names";

/**
 * Throwaway downstream component (chant#886 acceptance: "a downstream stub
 * component resolves at least cluster ARN, listener ARN, target-group ARNs,
 * repo URIs, and SG ids via stackOutput(...)"). Not one of #887 (RDS)/#888
 * (Cognito)/#889 (ECS services) — just proof that `shared-foundation`'s
 * named outputs resolve for a real consumer. Echoes each one into its own
 * SSM parameter (`../downstream-stub/stub.ts`).
 */
const fromSharedFoundation = {
  ecsClusterArn: stackOutput("shared-foundation", "oEcsClusterArn"),
  httpsListenerArn: stackOutput("shared-foundation", "oHttpsListenerArn"),
  frontendTargetGroupArn: stackOutput("shared-foundation", "oFrontendTargetGroupArn"),
  backendTargetGroupArn: stackOutput("shared-foundation", "oBackendTargetGroupArn"),
  frontendRepositoryUri: stackOutput("shared-foundation", "oFrontendRepositoryUri"),
  backendRepositoryUri: stackOutput("shared-foundation", "oBackendRepositoryUri"),
  albSecurityGroupId: stackOutput("shared-foundation", "oAlbSecurityGroupId"),
  ecsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
};

export const downstreamStub: Component = {
  name: "downstream-stub",
  archetype: "infra",
  dependsOn: ["shared-foundation"],
  deploy: [
    // Synthesize this stack's template on the deploy path. cfn-deploy reads
    // `dist/downstream-stub.template.json` from disk and `chant run --components`
    // never builds it, so without this phase a deploy applies whatever stale
    // template is lying in dist/ (or fails in a fresh checkout). The build
    // reads the LOOM_* env vars the run was started with
    // (test/claims/params/reach-deploy.sh).
    phase("Synth", [
      {
        kind: "shell",
        cmd: "npm run -s synth:downstream-stub",
        reason: "synthesize dist/downstream-stub.template.json from the run's build params before cfn-deploy reads it; no verb builds a lexicon stack inside a component run",
      },
    ]),
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: downstreamStubStackName,
        template: "dist/downstream-stub.template.json",
        inputs: fromSharedFoundation,
      },
    ]),
  ],
};
