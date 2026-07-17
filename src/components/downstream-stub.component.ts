import { phase, stackOutput, type Component } from "@intentius/chant/components";
import { sn } from "../lib/stack-name";

/**
 * Throwaway downstream component (chant#886 acceptance: "a downstream stub
 * component resolves at least cluster ARN, listener ARN, target-group ARNs,
 * repo URIs, and SG ids via stackOutput(...)"). Not one of #887 (RDS)/#888
 * (Cognito)/#889 (ECS services) — just proof that `shared-foundation`'s
 * named outputs resolve for a real consumer. Echoes each one into its own
 * SSM parameter (`../downstream-stub/stub.ts`).
 */
const fromSharedFoundation = {
  ecsClusterArn: stackOutput(sn("shared-foundation"), "oEcsClusterArn"),
  httpsListenerArn: stackOutput(sn("shared-foundation"), "oHttpsListenerArn"),
  frontendTargetGroupArn: stackOutput(sn("shared-foundation"), "oFrontendTargetGroupArn"),
  backendTargetGroupArn: stackOutput(sn("shared-foundation"), "oBackendTargetGroupArn"),
  frontendRepositoryUri: stackOutput(sn("shared-foundation"), "oFrontendRepositoryUri"),
  backendRepositoryUri: stackOutput(sn("shared-foundation"), "oBackendRepositoryUri"),
  albSecurityGroupId: stackOutput(sn("shared-foundation"), "oAlbSecurityGroupId"),
  ecsSecurityGroupId: stackOutput(sn("shared-foundation"), "oEcsSecurityGroupId"),
};

export const downstreamStub: Component = {
  name: "downstream-stub",
  archetype: "infra",
  dependsOn: ["shared-foundation"],
  deploy: [
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: sn("downstream-stub"),
        template: "dist/downstream-stub.template.json",
        inputs: fromSharedFoundation,
      },
    ]),
  ],
};
