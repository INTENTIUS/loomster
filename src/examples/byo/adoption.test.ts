/**
 * Verification for the "bring-your-own-everything" adoption example
 * (chant#898). Two things this file proves that the per-composite unit
 * tests (`../../composites/*.test.ts`) don't already cover on their own:
 *
 * 1. The shipped example modules under this directory (`./shared-foundation`,
 *    `./loom-db`, `./loom-cognito`, `./loom-cognito-second-instance`,
 *    `./loom-backend`, `./loom-frontend`) actually compose together —
 *    reference-existing network/KMS/ECR/ACM/Route53/agent-role/RDS/Cognito
 *    end to end — and every stack that has resources of its own still
 *    serializes to valid CloudFormation with no dangling `Ref`/`Fn::GetAtt`
 *    targets.
 * 2. The shared-identity-across-Looms pattern (chant#898's other settled
 *    decision): two independent Loom instances referencing the exact same
 *    org Cognito pool produce zero Cognito resources between them — no
 *    per-instance pool, ever.
 *
 * It also draws two documented boundaries rather than papering over them
 * (see docs/adoption.md for the full writeup):
 *
 * - PrivateLink has no independent `omit` seam yet — it is gated purely by
 *   tier (`fullTier` in `../../composites/shared-foundation.ts`). This file
 *   exercises the only lever that exists today (choosing `light` vs.
 *   `production`), and says so, rather than asserting a seam that isn't
 *   there.
 * - There is no bastion composite anywhere in this codebase (Loom's own
 *   upstream template has none either) — nothing to omit, so nothing is
 *   tested here. Noted in docs/adoption.md instead of a fabricated test.
 *
 * Zero edits to any file under `../../composites/` — every fixture below
 * either imports the shipped example modules unmodified or calls the
 * existing composite functions directly with fresh reference-existing/omit
 * props, exactly like `../../composites/*.test.ts` already does.
 */

import { describe, test, expect } from "vitest";
import { expandComposite, type CompositeInstance } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { SharedFoundation } from "../../composites/shared-foundation";
import type { LoomNamingParams } from "../../lib/naming";

// Imported modules export `byoXxx` bindings, not the bare composite names
// (`foundation`/`db`/`cognito`/`backend`/`frontend`), so they don't collide
// with the real stacks' identically-shaped exports once chant's
// whole-project discovery walks both trees in one pass (chant#928). Aliased
// back to the short names here purely for readability within this file.
import { byoFoundation as foundation } from "./shared-foundation/foundation";
import { byoDb as db } from "./loom-db/db";
import { byoCognito as cognito } from "./loom-cognito/cognito";
import * as cognitoParams from "./loom-cognito/params";
import { byoCognitoSecondInstance as cognitoSecondInstance } from "./loom-cognito-second-instance/cognito";
import * as cognitoSecondParams from "./loom-cognito-second-instance/params";
import { byoBackend as backend } from "./loom-backend/backend";
import { byoFrontend as frontend } from "./loom-frontend/frontend";

/** Every `Ref`/`Fn::GetAtt` target in a synthesized template must resolve to a declared Resource or Parameter — otherwise it's a dangling wiring reference (the same failure mode comp002 guards components against, at the composite/template level). */
function assertNoDanglingRefs(template: Record<string, any>): void {
  const known = new Set([
    ...Object.keys(template.Resources ?? {}),
    ...Object.keys(template.Parameters ?? {}),
  ]);
  const found = new Set<string>();

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.Ref === "string") found.add(obj.Ref);
      if (obj["Fn::GetAtt"] !== undefined) {
        const target = obj["Fn::GetAtt"];
        const logicalId = Array.isArray(target) ? (target[0] as string) : (target as string).split(".")[0];
        found.add(logicalId);
      }
      for (const value of Object.values(obj)) walk(value);
    }
  }

  walk(template.Resources);
  walk(template.Outputs);

  for (const id of found) {
    expect(known.has(id), `dangling reference to unknown logical id "${id}"`).toBe(true);
  }
}

/** `expandComposite` -> `resolveAttrRefs` -> `awsSerializer.serialize` -> parsed JSON, same pipeline every composite test in this repo already uses (see e.g. `../../composites/shared-foundation.test.ts`'s "serializes to valid CloudFormation" suite). */
function synthesize(name: string, instance: CompositeInstance): Record<string, any> {
  const expanded = expandComposite(name, instance);
  resolveAttrRefs(expanded);
  const raw = awsSerializer.serialize(expanded) as string;
  expect(raw).not.toContain("[object Object]");
  const template = JSON.parse(raw);
  expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
  return template;
}

describe("BYO-everything example (chant#898) — shared-foundation", () => {
  test("reference-existing network/KMS/ECR/ACM/Route53/agent-role: no VPC, KMS key, ECR repo, certificate, hosted zone, or agent role members", () => {
    const names = Object.keys(foundation.members);
    for (const absent of ["vpc", "publicSubnet1", "kmsKey", "kmsAlias", "frontendRepo", "backendRepo", "certificate", "hostedZone", "agentRole"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("still builds the ALB/ECS/artifact-bucket/PrivateLink this composite always owns", () => {
    const names = Object.keys(foundation.members);
    for (const expected of ["albSg", "ecsSg", "alb", "frontendTargetGroup", "backendTargetGroup", "artifactBucket", "ecsCluster", "nlb", "vpcEndpointService"]) {
      expect(names).toContain(expected);
    }
  });

  test("Route53 reference-existing: the DNS record still builds, wired to the given hosted zone id (no hostedZone member)", () => {
    const dnsRecordProps = (foundation.dnsRecord as any).props;
    expect(dnsRecordProps.HostedZoneId).toBe("Z1EXAMPLE23456AB");
  });

  test("ACM reference-existing: the HTTPS listener uses the given certificate ARN (no certificate member)", () => {
    const listenerProps = (foundation.httpsListener as any).props;
    const cert = (listenerProps.Certificates[0] as any).props;
    expect(cert.CertificateArn).toBe("arn:aws:acm:us-east-1:123456789012:certificate/2222bbbb-22bb-22bb-22bb-2222bbbb2222");
  });

  test("produces valid CloudFormation with no dangling refs (WAW042 S3 TLS-deny is a separate, pre-existing gap — see docs/adoption.md)", () => {
    // `chant build` on this directory currently exits non-zero because of
    // WAW042 (the artifact bucket has no explicit Deny-non-TLS policy) — a
    // gap in `../../composites/shared-foundation.ts` this example does not
    // introduce and this test does not paper over (reproduces identically
    // on the repo's real, unmodified `src/shared-foundation` stack too, and
    // is tracked separately — see docs/adoption.md's "Known gaps" section).
    // Synthesizing directly (bypassing chant build's post-synth pipeline,
    // same convention `../../composites/*.test.ts` already uses) proves the
    // *seam wiring itself* is sound independent of that unrelated gap.
    const template = synthesize("byoSharedFoundation", foundation);
    assertNoDanglingRefs(template);
    expect(template.Resources.byoSharedFoundationAlb.Type).toBe("AWS::ElasticLoadBalancingV2::LoadBalancer");
  });
});

describe("BYO-everything example (chant#898) — loom-db", () => {
  test("reference-existing data tier: zero members — nothing of this stack's own to build", () => {
    expect(Object.keys(db.members)).toHaveLength(0);
  });
});

describe("BYO-everything example (chant#898) — loom-cognito: shared identity across Looms", () => {
  test("reference-existing identity tier: zero members for both instances — no pool provisioned by either", () => {
    expect(Object.keys(cognito.members)).toHaveLength(0);
    expect(Object.keys(cognitoSecondInstance.members)).toHaveLength(0);
  });

  test("both instances reference the identical pool/domain/clients — one pool, two Looms, chant#898's multi-instance pattern", () => {
    const first = cognitoParams.identity;
    const second = cognitoSecondParams.identity;
    if (first.mode !== "reference-existing" || second.mode !== "reference-existing") {
      throw new Error("expected both instances to be reference-existing");
    }
    expect(second.userPoolId).toBe(first.userPoolId);
    expect(second.domain).toBe(first.domain);
    expect(second.m2mClientId).toBe(first.m2mClientId);
  });

  test("the two instances are genuinely distinct Loom deployments (different naming.instance), not the same stack twice", () => {
    expect(cognitoSecondParams.namingParams.instance).not.toBe(cognitoParams.namingParams.instance);
    expect(cognitoSecondParams.namingParams.instance).toBe("shared-b");
    expect(cognitoParams.namingParams.instance).toBe("shared-a");
  });
});

describe("BYO-everything example (chant#898) — loom-backend / loom-frontend", () => {
  test("backend composes against an external cluster/target-group/DB-secret/Cognito-pool with no shared-foundation/loom-db/loom-cognito resources of its own", () => {
    const names = Object.keys(backend.members);
    for (const expected of ["executionRole", "taskRole", "taskDefinition", "service", "logGroup", "logsKmsKey"]) {
      expect(names).toContain(expected);
    }
    // Known gap (docs/adoption.md): LoomBackend always provisions its own
    // execution/task roles — there is no reference-existing seam for them
    // yet, unlike every upstream piece it depends on. Documented, not hidden.
    expect(names).toContain("executionRole");
    expect(names).toContain("taskRole");
  });

  test("backend produces valid CloudFormation with no dangling refs", () => {
    const template = synthesize("byoLoomBackend", backend);
    assertNoDanglingRefs(template);
    expect(template.Resources.byoLoomBackendService.Type).toBe("AWS::ECS::Service");
    expect(template.Resources.byoLoomBackendService.Properties.Cluster).toBe(
      "arn:aws:ecs:us-east-1:123456789012:cluster/loom-prod-shared-a-shared-foundation-cluster",
    );
  });

  test("frontend produces valid CloudFormation with no dangling refs", () => {
    const template = synthesize("byoLoomFrontend", frontend);
    assertNoDanglingRefs(template);
    expect(template.Resources.byoLoomFrontendService.Type).toBe("AWS::ECS::Service");
  });
});

describe("BYO-everything example (chant#898) — omit for optional add-ons", () => {
  const naming: LoomNamingParams = {
    project: "loom",
    env: "test",
    instance: "omit-check",
    tier: "production",
    region: "us-east-1",
    accountId: "111111111111",
    owner: "platform",
  };
  const network = {
    mode: "reference-existing" as const,
    vpcId: "vpc-1",
    publicSubnetIds: ["subnet-pub1", "subnet-pub2"],
    privateSubnetIds: ["subnet-priv1", "subnet-priv2"],
  };

  test("agents: agentRole omit produces no Role member and a valid, dangling-ref-free template", () => {
    const instance = SharedFoundation({
      naming,
      network,
      domainName: "loom.example.com",
      agentRole: { mode: "omit" },
    });
    expect(Object.keys(instance.members)).not.toContain("agentRole");
    const template = synthesize("omitAgent", instance);
    assertNoDanglingRefs(template);
  });

  test("kms + ecr both omit: no KMS/ECR members, ALB/cluster/bucket still build cleanly", () => {
    const instance = SharedFoundation({
      naming,
      network,
      domainName: "loom.example.com",
      kms: { mode: "omit" },
      ecr: { mode: "omit" },
    });
    const names = Object.keys(instance.members);
    expect(names).not.toContain("kmsKey");
    expect(names).not.toContain("frontendRepo");
    const template = synthesize("omitKmsEcr", instance);
    assertNoDanglingRefs(template);
  });

  test("PrivateLink: no independent seam yet — tier is the only current lever (documented gap, docs/adoption.md)", () => {
    const lightInstance = SharedFoundation({
      naming: { ...naming, tier: "light" },
      network: { mode: "reference-existing" as const, vpcId: "vpc-1", publicSubnetIds: ["subnet-pub1", "subnet-pub2"] },
    });
    expect(Object.keys(lightInstance.members)).not.toContain("nlb");
    expect(Object.keys(lightInstance.members)).not.toContain("vpcEndpointService");

    const prodInstance = SharedFoundation({ naming, network, domainName: "loom.example.com" });
    expect(Object.keys(prodInstance.members)).toContain("nlb");
    expect(Object.keys(prodInstance.members)).toContain("vpcEndpointService");
  });
});
