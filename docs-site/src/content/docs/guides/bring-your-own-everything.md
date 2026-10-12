---
title: Bring your own everything
description: Build the src/examples/byo example, which sets every seam to reference-existing against one set of platform-owned resources with no change to any composite, and use it as the template for your own.
prompt: |
  Read https://intentius.io/loomster/guides/bring-your-own-everything/ and build the example's stacks with the page's commands, then run its test.
  Report what each stack creates and references, and the test result.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

Templates for a Loom that creates nothing a platform team already owns, and a
test that proves they compose on every [tier](/loomster/concepts/tiers-and-instances/).

## Prerequisites

The repository with `npm install` run. Nothing is deployed.

## Steps

1. Look at the layout. `src/examples/byo/` uses one set of illustrative
   platform-owned resources: a VPC, a KMS key, a certificate and hosted zone, two
   ECR repositories, an agent role, an external Postgres endpoint and one shared
   Cognito pool.

   | Directory | Seams set to `reference-existing` |
   |---|---|
   | `shared-foundation/` | network, kms, ecr, route53, acm, agentRole |
   | `loom-db/` | data, an external Postgres endpoint |
   | `loom-cognito/` | identity, the shared pool, first instance |
   | `loom-cognito-second-instance/` | the same pool, second instance |
   | `loom-backend/` | built against the external cluster, target group, database secret and pool |
   | `loom-frontend/` | built against the external cluster and target group |

   Every file calls the composites in `src/composites/` with reference props or
   imports a sibling. Nothing under `src/composites/` changed.

2. Build the stacks that create resources of their own:

   ```
   npx chant build src/examples/byo/shared-foundation --lexicon aws
   npx chant build src/examples/byo/loom-backend --lexicon aws
   npx chant build src/examples/byo/loom-frontend --lexicon aws
   ```

   `loom-db`, `loom-cognito` and the second Cognito instance reference
   everything, so they create no resources and there is nothing to build alone;
   their outputs feed the stacks after them.

3. Run the test:

   ```
   npx vitest run src/examples/byo/adoption.test.ts
   ```

   It checks that the modules compose, that both Cognito instances resolve to one
   pool with nothing created, that every stack with resources serializes to
   valid CloudFormation with no dangling `Ref` or `Fn::GetAtt`, and that the whole
   set holds on light, production and production-ha.

4. Copy the pattern: replace the illustrative ids with yours, as build
   parameters ([Build parameters](/loomster/reference/parameters/)) for the real
   components, or as literals in your own stack directory.

## Next

[Adoption seams](/loomster/reference/adoption-seams/) lists each seam's
requirements.
