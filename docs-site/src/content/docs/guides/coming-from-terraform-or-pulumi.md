---
title: Coming from Terraform, Terragrunt or Pulumi
description: The Terraform, Terragrunt and Pulumi commands and concepts you know, what does the same job in loomster, and what changes when CloudFormation holds the state.
prompt: |
  Read https://intentius.io/loomster/guides/coming-from-terraform-or-pulumi/ and show the person, in this checkout, the equivalents of a plan, a module, a variable file and a remote-state dependency, with file paths.
  Run `npm run synth` and `npx chant graph --components` and report the output.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A map from Terraform, Terragrunt and Pulumi to loomster, and what you stop
managing because CloudFormation keeps the state.

## The first command

```
npm install
npx chant graph --components     # the dependency order, as Terragrunt's run-all would see it
npm run synth                    # one CloudFormation template per component in dist/
```

## Commands

| To do this | Terraform or Terragrunt | Pulumi | loomster |
|---|---|---|---|
| A reusable unit | a module | a component resource | a composite in `src/composites/` |
| A deployable root | a root module, a Terragrunt unit | a stack | a component, one CloudFormation stack |
| Inputs | `variables.tf`, `.tfvars` | `Pulumi.<stack>.yaml` config | build parameters in `chant.config.ts`, set by `LOOM_*` variables |
| Read another root's outputs | `terraform_remote_state`, Terragrunt `dependency` | `StackReference` | `stackOutput("<component>", "<output>")` |
| Apply in dependency order | `terragrunt run-all apply` | per stack, in the order you choose | `npx chant run --components all` |
| Plan | `terraform plan` | `pulumi preview` | `chant lifecycle diff --live` (`npm run watch`) |
| Environments | workspaces or directories | stacks | `LOOM_ENV` and `LOOM_INSTANCE` |
| Bring an existing resource under management | `import` blocks | `pulumi import` | reference it through a seam ([Provision, reference or omit](/loomster/concepts/adoption-seams/)) |
| Pull a console change into code | `terraform plan -refresh-only`, then edit | `pulumi refresh` | `npm run reconcile` opens a pull request ([Watch and reconcile drift](/loomster/guides/watch-and-reconcile-drift/)) |
| Destroy | `terraform destroy` | `pulumi destroy` | `chant run loom-teardown`, gated |
| Providers | the AWS provider | `@pulumi/aws` | chant's AWS and Docker lexicons |

## Behavior differences

- No state file and no lock. CloudFormation keeps the state as a service, so
  there is no backend bucket, lock table or state surgery.
- Rollback is automatic. Where Terraform leaves a partial apply, CloudFormation
  returns a failed stack to its last good state, and the frontend and backend
  components also put the previous task definition back.
- The plan, `chant lifecycle diff --live`, compares the source with the live
  resources, so it shows drift as well as your change.
- chant marks what it owns with `chant:managed-by` tags, and reconcile only ever
  touches those resources.
- Build parameters are resolved once, at synth. A template never reads the
  environment at apply time.

## Left out on purpose

| Not here | In Terraform or Pulumi | loomster's rule | Do this instead |
|---|---|---|---|
| A state backend | S3 and DynamoDB, Terraform Cloud, Pulumi Cloud | CloudFormation holds state | nothing to run |
| Importing a resource into loomster's stacks | `import` blocks, `pulumi import` | a resource someone else owns stays theirs | reference it through a seam |

## Next

- [Choosing chant](/loomster/concepts/why-chant/).
- [Tiers and instances](/loomster/concepts/tiers-and-instances/).
