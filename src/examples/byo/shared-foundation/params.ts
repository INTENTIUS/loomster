/**
 * "Bring-your-own-everything" adoption example (chant#898) — the
 * `shared-foundation` half. Every referenceable seam
 * (`network`/`kms`/`ecr`/`acm`/`route53`/`agentRole`) is set to
 * `reference-existing`, pointed at resources a platform/security team
 * already owns. `chant build src/examples/byo/shared-foundation --lexicon
 * aws` creates zero VPC, KMS key, ECR repo, ACM certificate, Route53 zone,
 * or IAM role — only the ALB, security groups, ECS cluster, and artifact
 * bucket this composite still owns unconditionally.
 *
 * The ids/ARNs below are illustrative placeholders — swap them for your own
 * platform team's real values; nothing else in this file (or the composite
 * it feeds — `../../../composites/shared-foundation.ts`, untouched by this
 * example) needs to change to point at a real VPC/KMS/ACM/Route53/ECR/role.
 * This file has zero resource constructors of its own — same convention the
 * repo's real `src/shared-foundation/params.ts` uses — so none of chant's
 * EVL rules apply here.
 */

import type { LoomNamingParams } from "../../../lib/naming";
import type {
  NetworkSeam,
  KmsSeam,
  EcrSeam,
  Route53Seam,
  AcmSeam,
  AgentRoleSeam,
} from "../../../composites/shared-foundation";

export const namingParams: LoomNamingParams = {
  project: "loom",
  env: "prod",
  // "shared-a" — this is the *first* of two Loom instances in this example
  // that share one org-level Cognito pool (see ../loom-cognito-second-
  // instance/); shared-foundation/loom-db/loom-backend/loom-frontend are
  // NOT shared across instances the way identity is (chant#898's settled
  // decision draws that line at Cognito specifically), so only one of each
  // of those exists in this example.
  instance: "shared-a",
  tier: "production",
  region: "us-east-1",
  accountId: "123456789012",
  owner: "platform-team",
};

/** A platform-owned subdomain this Loom instance is delegated (Route53 zone reference-existing below owns the parent). */
export const domainName = "loom.example.com";

/**
 * Reference-existing is the primary case (chant#898's settled decision): a
 * platform team hands over a VPC id + subnet ids by AZ/tier, and this
 * composite wires the ALB/ECS/RDS security groups into them directly —
 * chant creates no VPC, subnet, route table, or internet gateway.
 * `privateSubnetIds` is required here because this example runs the
 * production tier, which always provisions PrivateLink (see docs/adoption.md
 * for why that is currently tier-gated rather than its own seam).
 */
export const network: NetworkSeam = {
  mode: "reference-existing",
  vpcId: "vpc-0d1e2a3b4c5d6e7f8",
  publicSubnetIds: ["subnet-0aaa1111222233334", "subnet-0bbb2222333344445"],
  privateSubnetIds: ["subnet-0ccc3333444455556", "subnet-0ddd4444555566667"],
};

/** The security team's own KMS key, already granted to ECR + the account root. */
export const kms: KmsSeam = {
  mode: "reference-existing",
  kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/1111aaaa-11aa-11aa-11aa-1111aaaa1111",
};

/** ECR repos the platform team's central image-registry account already provisioned and scans. */
export const ecr: EcrSeam = {
  mode: "reference-existing",
  frontendRepositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/loom-frontend",
  frontendRepositoryArn: "arn:aws:ecr:us-east-1:123456789012:repository/loom-frontend",
  backendRepositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/loom-backend",
  backendRepositoryArn: "arn:aws:ecr:us-east-1:123456789012:repository/loom-backend",
};

/** The org's shared Route53 zone for loom.example.com, delegated from the parent account. */
export const route53: Route53Seam = {
  mode: "reference-existing",
  hostedZoneId: "Z1EXAMPLE23456AB",
};

/** ACM cert already issued (and DNS-validated) against the referenced zone above. */
export const acm: AcmSeam = {
  mode: "reference-existing",
  certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/2222bbbb-22bb-22bb-22bb-2222bbbb2222",
};

/** The security team's own least-privilege AgentCore execution role — chant attaches nothing it wasn't given. */
export const agentRole: AgentRoleSeam = {
  mode: "reference-existing",
  agentRoleArn: "arn:aws:iam::123456789012:role/platform-loom-agent-role",
};

/** Central logging account's access-log bucket. */
export const loggingBucketName = "platform-central-access-logs";
