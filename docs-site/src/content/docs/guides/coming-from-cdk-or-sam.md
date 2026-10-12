---
title: Coming from CDK, SAM or CloudFormation
description: The CDK, SAM and CloudFormation commands and concepts you know, what does the same job in loomster's chant source, and what works differently.
prompt: |
  Read https://intentius.io/loomster/guides/coming-from-cdk-or-sam/ and walk the person through one component in this checkout: its composite in src/composites/, its component in src/components/, and the template `npm run synth` writes for it.
  Run `npm run synth` and `chant lint .` and report the results.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A map from CDK, SAM and raw CloudFormation to loomster's
[chant](/loomster/concepts/glossary/#chant) source, so you can read a composite,
change a parameter and deploy.

## The first command

```
npm install
npm run synth          # writes dist/<component>.template.json
```

Every file in `dist/` is a plain CloudFormation template, the same output CDK and
SAM produce.

## Commands

| To do this | CDK | SAM or CloudFormation | loomster |
|---|---|---|---|
| Define infrastructure | a `Stack` class and constructs | `template.yaml` | a composite in `src/composites/`, wrapped as a component in `src/components/` |
| Reuse a pattern | an L3 construct | a nested stack or a module | a composite with props |
| Synthesize | `cdk synth` | `sam build` | `npm run synth`, or `chant build src/<stack> --lexicon aws` |
| Deploy one stack | `cdk deploy Stack` | `sam deploy` | `npx chant run --components <name>` |
| Deploy everything in order | `cdk deploy --all` | a script or pipeline you write | `npx chant run --components all` |
| Pass values between stacks | props or `Fn.importValue` | outputs copied into parameters | `stackOutput("<component>", "<output>")` |
| Parameterize | context in `cdk.json` | `--parameter-overrides`, `samconfig.toml` | build parameters in `chant.config.ts`, set by `LOOM_*` variables |
| Separate environments | a `Stage`, the `env` of a stack | `samconfig` environments | `LOOM_ENV` and `LOOM_INSTANCE` in every name and stack name |
| Preview a change | `cdk diff` | a change set | `chant lifecycle diff --live`, or `npm run watch` |
| Lint | cdk-nag | cfn-lint | `chant lint .`, with loomster's own rules in `.chant/rules/` |
| Unit test | `aws-cdk-lib/assertions` | | vitest over the composites (`npm test`) |
| Delete | `cdk destroy` | `sam delete` | `chant run loom-teardown`, gated |
| Pipeline | CDK Pipelines | `sam pipeline init` | generated GitHub, GitLab and Forgejo pipelines ([Add CI to your forge](/loomster/guides/add-ci-to-your-forge/)) |
| Bootstrap an account | `cdk bootstrap` | an artifact bucket | none for the templates; images go to the stack's own ECR repositories |

## Behavior differences

- chant evaluates source at build time and never at deploy time. Its lint
  (`EVL001` to `EVL004`) refuses property values it can't reduce statically, so a
  composite reads like data, not a program that runs during deploy.
- There is no CDK runtime, no asset bucket and no bootstrap stack. A template is
  synthesized once and applied as is.
- Stack names carry `{project}-{env}-{instance}`, so two deployments never
  collide ([Tiers and instances](/loomster/concepts/tiers-and-instances/)).
- Physical names come from one helper, `loomNaming`, and lint rule `LOOM001`
  rejects a hard-coded one ([Naming and tagging](/loomster/reference/naming/)).
- Day-2 work is [Ops](/loomster/reference/ops/) with approval gates recorded in
  git, not scripts beside the app.
- CloudFormation still holds the state, as with CDK and SAM.

## Left out on purpose

| Not here | In CDK or SAM | loomster's rule | Do this instead |
|---|---|---|---|
| Runtime logic in the infrastructure code (loops over API calls, lookups at synth) | `Vpc.fromLookup`, custom code in `synth` | the template depends only on source and parameters | pass ids as build parameters ([Provision, reference or omit](/loomster/concepts/adoption-seams/)) |
| Deploying from a laptop as the normal path | `cdk deploy` | production deploys go through your change process | the gated `deploy.yml`, after a first run you do by hand |

## Next

- [Choosing chant](/loomster/concepts/why-chant/).
- [Architecture](/loomster/concepts/how-it-works/).
- [Deploy without chant](/loomster/guides/deploy-without-chant/) if you'd rather
  apply the templates with your own tools.
