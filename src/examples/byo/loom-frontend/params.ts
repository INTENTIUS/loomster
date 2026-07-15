/**
 * "Bring-your-own-everything" adoption example (chant#898) — the
 * `loom-frontend` half. Same convention as `../loom-backend/params.ts`:
 * plain literal stand-ins for `stackOutput("shared-foundation", "<key>")`
 * values a real deploy pipeline resolves automatically (see
 * `../../../components/loom-frontend.component.ts`). `LoomFrontend`
 * (chant#889) has no execution/task-role split (the frontend has no task
 * role at all — see `../../../composites/loom-frontend.ts`'s file header),
 * so the only IAM-role gap here is the one execution role, same known
 * limitation `../loom-backend/params.ts` documents.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type { LogRetentionDays } from "../../../composites/loom-backend";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  instance: "shared-a",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

// ── Stand-ins for ../shared-foundation's stackOutput("shared-foundation", "<key>") values ──
export const ecsClusterArn = "arn:aws:ecs:us-east-1:123456789012:cluster/loom-prod-shared-a-shared-foundation-cluster";
export const ecsSecurityGroupId = "sg-0eee5555666677778";
export const targetGroupArn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/loom-prod-shared-a-fe-tg/0123456789abcdef";

/** Published image (build-once, promote-by-digest, `@Publish.uri`) — a placeholder digest reference here since this example does not build a real image. */
export const imageUri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/loom-frontend@sha256:0000000000000000000000000000000000000000000000000000000000bb";

/** Public subnet ids — the frontend task gets a public IP directly (matches Loom's own `AssignPublicIp: ENABLED`); same ones handed to `../shared-foundation/params.ts`'s `network.publicSubnetIds`. */
export const publicSubnetIds: string[] = ["subnet-0aaa1111222233334", "subnet-0bbb2222333344445"];

export const cpu: string | undefined = undefined;
export const memory: string | undefined = undefined;
export const desiredCount: number | undefined = undefined;
export const logRetentionDays: LogRetentionDays | undefined = undefined;
