---
title: Gated Ops
description: How loomster's lifecycle Ops run, why the destructive ones stop at an approval gate recorded on the chant/lifecycle branch, and how they are triggered.
---

loomster ships the day-2 lifecycle of a Loom deployment as
[chant Ops](https://intentius.io/chant/guide/ops/) in `ops/`. Each runs in
process with `chant run <op>`. The list is in [Ops](/loomster/reference/ops/).

## The gate

An Op whose change can't be undone by running it again stops at a gate:
upgrade on the production [tiers](/loomster/concepts/tiers-and-instances/),
rotation, restore and teardown. The run writes a pending fact to the
`chant/lifecycle` branch and exits with code 3. A person records the approval
as another fact, and the next run reads it and carries on:

```
chant run loom-upgrade-production            # stops at "Approve", exit 3
chant approve loom-upgrade-production approve-loom-upgrade-production
chant run loom-upgrade-production            # continues past the approved gate
```

Nothing waits in between, so a run that crashed resumes when you run it again.
The approval is a git commit, so who approved what, and when, stays in the
repository.

The ungated Ops are the ones that add or only read: backup, the restore drill
(it restores to a throwaway instance and deletes it), seed, the Cognito export,
drift watch, and reconcile (it opens a pull request and never changes the
cloud).

## Keeping the ledger local

chant pushes `chant/lifecycle` to `origin` after each write. `just install` adds
a pre-push hook that refuses that branch unless `CI` is set or
`LOOM_LEDGER_PUSH=1`, so a local or [Floci](/loomster/concepts/glossary/#floci) run keeps its ledger in the checkout.
Set `LOOM_LEDGER_PUSH=1` when someone approves your gates from another clone. If
CI has since written to the remote ledger and your local branch holds facts it
never pushed, chant refuses the diverged ledger; reset the local branch to the
remote one to rejoin it.

## Triggers

An Op is a workflow; how it starts is separate. There are three hosts, and a
team can mix them:

- On demand: `chant run <op>`, or its `npm run` alias.
- Op schedules: `loom-watch` and `loom-reconcile` carry a `schedule` that
  `chant run --generate` renders as a CI cron.
- CI crons: inert GitHub Actions workflows a team turns on with a repo variable
  ([Turn on scheduled Ops](/loomster/guides/turn-on-scheduled-ops/)).

The gated Ops are never scheduled. A person runs and approves them.

## Polling instead of gating

Where a wait has a condition the Op can observe, it polls instead of gating, so
it finishes in one run. `loom-dns-setup` prints the NS records, then polls
public DNS until you have added the delegation, instead of asking for an
approval nobody can check.
