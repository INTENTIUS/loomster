---
title: Add CI to your forge
description: Generate the component pipeline for GitHub, GitLab or Forgejo from loomster's component graph, keep it in step with the graph, give its jobs a runner, and turn on the gated deploy.
prompt: |
  Read https://intentius.io/loomster/guides/add-ci-to-your-forge/ and regenerate the pipeline for the person's forge with the page's npm script, then run `npm test` to confirm the committed file matches.
  Open a pull request with any change. Don't set the DEPLOY variable or create environments or secrets.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A component pipeline on your forge that deploys in the graph's order, a test that
fails when it drifts from the graph, and a deploy workflow that runs once you
turn it on.

## Prerequisites

A fork or copy of the repository on GitHub, GitLab or Forgejo (Codeberg, Gitea).

## Steps

1. Generate the pipeline for your forge:

   ```
   npm run generate:github    # .github/workflows/components.yml
   npm run generate:gitlab    # .gitlab/components.yml, included by .gitlab-ci.yml
   npm run generate:forgejo   # .forgejo/workflows/components.yml
   ```

   One stage per [wave](/loomster/concepts/glossary/#wave), one job per component,
   dependency edges from the graph, each stack's outputs passed to the next job
   as artifacts. Regenerate whenever a component or dependency changes;
   `npm test` fails while the committed file differs from a fresh generate.

2. Give the jobs a runner. Each job runs `chant run --components <name>` and
   expects [chant](/loomster/concepts/glossary/#chant), its dependencies and the AWS CLI. Set it once through
   `generateComponentPipeline`'s options: `image` for a runner image with both
   installed, or `beforeScript: ["npm ci"]` plus an AWS CLI install on a stock
   image. Each component synthesizes its own template from the job's `LOOM_*`
   variables, so no synth job is needed. A Forgejo runner needs Docker access for
   the image builds.

3. Try it against [Floci](/loomster/concepts/glossary/#floci) before a real account:

   ```
   just github-runtime-e2e      # act
   just gitlab-runtime-e2e      # gitlab-ci-local
   just forgejo-runtime-e2e     # act
   ```

   These deploy the light [tier](/loomster/concepts/tiers-and-instances/)'s
   infrastructure components with the output handoff between waves. They need
   Docker.

4. Turn on the deploy. On GitHub, set the repository variable `DEPLOY` to `true`
   and create an environment named `production` holding the AWS credentials;
   `deploy.yml` then runs `chant run --components all --env "$LOOM_ENV"`. GitLab's
   `deploy` job and Forgejo's `deploy.yml` follow the same variable; GitLab's is
   a manual button and never runs on a schedule. Run the first real deploy
   yourself, behind your own change process, then let the pipeline take over.

## Next

- [Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/).
- [CI providers](/loomster/reference/ci/) for the file-by-file detail.
