---
title: Run your first Ops
description: Tutorial step 4. Back up a deployment, prove the backup restores without touching the live database, check for drift, and see how a gated Op stops for approval.
prompt: |
  Read https://intentius.io/loomster/tutorial/operate/ and run its ungated steps against the deployment the person names: `npm run backup`, `npm run restore-drill` and `npm run watch`.
  Report each run's result. Run the gated example only up to its gate and show the person the approval command.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

Deploying is the first day. Every day after is [Ops](/loomster/reference/ops/):
[chant](/loomster/concepts/glossary/#chant) workflows in `ops/` that you run with `chant run <name>`.

## Result

A labelled RDS snapshot, proof that it restores, a drift check against the live
stacks, and one gated Op stopped at its approval.

## Prerequisites

A deployment from [step 2](/loomster/tutorial/light-on-aws/) or
[step 3](/loomster/tutorial/production/), and the same `LOOM_*` variables and AWS
credentials you deployed it with.

## Steps

### 1. Back up

```
npm run backup
```

`loom-backup` takes a manual snapshot of the RDS instance, labelled so the
restore Ops can find it. With `LOOM_DR_REGION` set it also copies it to that
region. It only adds, so it has no gate.

### 2. Prove the backup restores

```
npm run restore-drill
```

`loom-restore-drill` restores the latest `loom-backup` snapshot to a throwaway
`-drill-` database, checks it reaches `available` with the source's engine,
version and storage, and deletes it on every exit path. It never touches the
live database, so it has no gate either.

### 3. Check for drift

```
npm run watch
```

`loom-watch` compares every stack with the live account
(`chant lifecycle diff --live`) and records the result on the `chant/lifecycle`
branch. [Watch and reconcile drift](/loomster/guides/watch-and-reconcile-drift/)
covers what to do when it finds some.

### 4. See a gate

A restore cuts the backend over to a new database, so `loom-restore` stops for
approval before the cutover:

```
chant run loom-restore                   # restores to a new instance, then stops at Approve (exit 3)
```

Here you would check the restored instance, then approve and run again:

```
chant approve loom-restore approve-loom-restore
chant run loom-restore                   # cuts over
```

Stopping at the gate costs a restored RDS instance until you delete it. Skip the
approval on a tutorial deployment and delete the restored database, or
follow [Back up and restore](/loomster/guides/back-up-and-restore/) through. Why
the gate is a git commit is in [Gated Ops](/loomster/concepts/gated-ops/).

## Next

- [Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/) to run backup,
  drift and the restore drill on a schedule.
- [On call](/loomster/for/on-call/) lists the runbooks.
