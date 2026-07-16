import { phase, stackOutput, type Component } from "@intentius/chant/components";

/**
 * The `loom-db` data tier (chant#887) — RDS Postgres, subnet group, KMS, the
 * 2 Secrets Manager secrets, and (production/production-ha) RDS Proxy +
 * secret rotation. `infra` archetype — no build, just apply. The template is
 * what `chant build src/loom-db --lexicon aws` synthesizes from
 * `../composites/loom-db.ts`.
 *
 * Depends on `shared-foundation` for its network (VPC + private subnets,
 * chant#928/loomster#35 — `oVpcId`/`oPrivateSubnetIds`, no more
 * `LOOM_VPC_ID`/`LOOM_PRIVATE_SUBNET_IDS` env vars) and its ECS security
 * group: `oEcsSecurityGroupId` is threaded in as the RDS security group's
 * ingress source (chant#898 — opt in via `LOOM_DB_SOURCE_SG=true`, see
 * `../loom-db/params.ts`'s `pEcsSecurityGroupId` Parameter and
 * `../loom-db/db.ts`). Named outputs (`../loom-db/outputs.ts`) are what #889
 * (the backend ECS service) attaches to via `stackOutput("loom-db", ...)`.
 */
export const loomDb: Component = {
  name: "loom-db",
  archetype: "infra",
  dependsOn: ["shared-foundation"],
  deploy: [
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "loom-db",
        template: "dist/loom-db.template.json",
        inputs: {
          pVpcId: stackOutput("shared-foundation", "oVpcId"),
          pPrivateSubnetIds: stackOutput("shared-foundation", "oPrivateSubnetIds"),
          pEcsSecurityGroupId: stackOutput("shared-foundation", "oEcsSecurityGroupId"),
        },
      },
    ]),
  ],
};
