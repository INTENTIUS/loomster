---
title: Watch and reconcile drift
description: Compare every stack with the live account on demand or on a schedule, and turn drift into a pull request that brings the source in line, for chant-owned resources only.
prompt: |
  Read https://intentius.io/loomster/guides/watch-and-reconcile-drift/ and run `npm run watch` for the deployment the person names.
  Report each stack's drift. Run `npm run reconcile` only if the person asked for a pull request in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A drift report for every stack, and, when something drifted, a pull request
that changes the source to match the cloud.

## Prerequisites

The deployment's `LOOM_*` variables and read access to its account.

## Steps

1. Watch:

   ```
   npm run watch                        # chant run loom-watch
   ```

   `loom-watch` runs `chant lifecycle snapshot` and `chant lifecycle diff --live`
   for the whole project, so one run covers every stack the deployment builds.
   The result lands as the run's outcome on the `chant/lifecycle` branch. Every
   [tier](/loomster/concepts/tiers-and-instances/) watches; its schedule is every
   15 minutes.

2. Decide which side is right. A change made in the console is either a fix the
   source should take, or a mistake the next deploy will undo. If the source is
   right, redeploy the component. If the cloud is right, reconcile.

3. Reconcile:

   ```
   npm run reconcile                    # chant run loom-reconcile
   ```

   `loom-reconcile` opens a pull request that regenerates the affected source
   from the live resources. It only changes source, never commits to `main` and
   never changes the cloud. It reconciles resources carrying [chant](/loomster/concepts/glossary/#chant)'s ownership
   marker (the `chant:managed-by` tags `chant.config.ts` stamps), so a resource
   someone else created is never touched. On the production tiers it also has an
   hourly schedule; light only observes on a schedule, but any tier can run it by
   hand.

4. Review the pull request like any other change, then deploy it.

To run both on a schedule, turn on `watch.yml` and `reconcile.yml`
([Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/)).

## Next

[Gated Ops](/loomster/concepts/gated-ops/) on how runs are recorded.
