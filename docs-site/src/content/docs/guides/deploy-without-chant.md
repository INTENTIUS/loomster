---
title: Deploy without chant
description: Export loomster's synthesized CloudFormation templates and generated CI per tier as a plain directory, and deploy them with the AWS CLI or your own pipeline.
prompt: |
  Read https://intentius.io/loomster/guides/deploy-without-chant/ and run `npm run export-bundle` with the person's network, domain and password variables exported.
  Report the bundle's layout and the deploy order from its README. Don't deploy it unless the person asked for that in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A directory per [tier](/loomster/concepts/tiers-and-instances/) holding one
CloudFormation template per component, the generated CI, and a README with the
deploy order and parameters, which you apply with `aws cloudformation deploy`
and no chant at deploy time.

## Prerequisites

The repository with `npm install` run, on the machine that exports. The
machine that deploys needs only the AWS CLI.

## Steps

1. Export the values that have no default. The network, the domain and the
   database password can't be synthesized from nothing; unset ones fall back to
   clearly labelled example values, so set your own:

   ```
   export LOOM_VPC_ID=vpc-... LOOM_PUBLIC_SUBNET_IDS=subnet-...,subnet-...
   export LOOM_PRIVATE_SUBNET_IDS=subnet-...,subnet-...
   export LOOM_DOMAIN_NAME=loom.example.com
   export LOOM_DB_PASSWORD=<from your secret store>
   ```

   Any other [build parameter](/loomster/reference/parameters/) you export is
   applied too.

2. Export the bundle:

   ```
   npm run export-bundle
   ```

   It writes `dist/bundle/loom-v1.9.0/{light,production,production-ha}/`, each
   with `templates/` (one synthesized template per component), `ci/` (the
   generated GitHub Actions and GitLab CI pipelines) and `manifest.json`, chant's
   Build Archive manifest with each template's content digest. The bundle's
   `README.md` lists the deploy order and every template's parameters, generated
   from the templates themselves.

3. Deploy the templates in the README's order with
   `aws cloudformation deploy`, passing each stack's outputs to the next as its
   parameters, or wire the templates into your existing pipeline.

What you give up: chant's ordering and output handoff, the image build and
publish phases (build and push Loom's images yourself), the health checks and
rollback, and the [Ops](/loomster/reference/ops/). The templates are the same
ones `chant run` applies.

`EXPORT_PERSIST_LEDGER=true` also records each tier's manifest on the local
`chant/lifecycle` branch.

## Next

[Choosing chant](/loomster/concepts/why-chant/) on what the tool adds, and
[Components](/loomster/reference/components/) for each stack's outputs.
