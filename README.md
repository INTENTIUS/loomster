# loomster

A deployment of [awslabs/loom](https://github.com/awslabs/loom) you run from a
repo. Loom v1.9.0 as six CloudFormation stacks in three tiers (`light`,
`production`, `production-ha`), a local stack on [Floci](https://floci.io),
lifecycle Ops for backup, restore, upgrade, rotation, drift and teardown, and
generated CI for GitHub, GitLab and Forgejo. Built with
[chant](https://intentius.io/chant); you run loomster by its verbs.

Docs: **https://intentius.io/loomster/**

## Quick start

Docker and Node.js 22 or later; no AWS account.

```
git clone https://github.com/INTENTIUS/loomster
cd loomster && npm install
just local-up      # Loom at http://localhost:8080, with the login it prints
just validate      # every screen, against the seeded data
just local-down
```

On an AWS account, the light tier:

```
export LOOM_TIER=light LOOM_ENV=dev LOOM_INSTANCE=a LOOM_DB_PASSWORD=<secret>
npm run vendor && just bootstrap
npx chant run --components all --env dev
```

## Where to go

- [Run Loom locally](https://intentius.io/loomster/getting-started/) and the
  [tutorial](https://intentius.io/loomster/tutorial/), from a laptop to production.
- Coming from [Loom's SAM deploy](https://intentius.io/loomster/guides/coming-from-upstream-loom/),
  [CDK or SAM](https://intentius.io/loomster/guides/coming-from-cdk-or-sam/),
  [Terraform or Pulumi](https://intentius.io/loomster/guides/coming-from-terraform-or-pulumi/),
  or the [AgentCore starter toolkit](https://intentius.io/loomster/guides/coming-from-agentcore-starter-toolkit/).
- [Validation](https://intentius.io/loomster/reference/validation/): what has run
  on each tier and target.
- [Architecture](https://intentius.io/loomster/concepts/how-it-works/),
  [Ops](https://intentius.io/loomster/reference/ops/),
  [Build parameters](https://intentius.io/loomster/reference/parameters/).

## With a coding agent

`skills/loomster/SKILL.md` gives an agent every verb and the rules, and every
task page on the site carries a prompt to hand it
([Drive loomster with an agent](https://intentius.io/loomster/guides/drive-with-an-agent/)).

## Develop

```
just check         # typecheck, chant lint, unit tests
npm run lint:docs  # the docs conventions (scripts/lint-docs.mjs)
cd docs-site && npm ci && npm run build
```

`package.json` takes `@intentius/chant` and its lexicons from npm; a fresh clone
builds on its own. Remove `vendor/loom` before `just check`, since a
whole-project `chant lint` reads it as project code.
