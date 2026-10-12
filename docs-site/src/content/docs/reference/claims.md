---
title: Claims
description: One check per documented capability, each with a BREAK mode that proves it can fail, and the human gate in front of the ones that deploy.
---

A claim is a script that checks one thing these docs say loomster does, such as
"the backend can deploy an agent through Loom's API" or "teardown deletes every
component". Each lives in `test/claims/<area>/<part>.sh` and is named
`<area>/<part>`. A green E2E run proves what it ran; a claim says which statement
that run proved.

```
just claims                                   # every claim
just claims params,teardown/covers-components # an area, or named claims
just claims-affected                          # the claims your change can affect
bash test/claims.sh --list                    # name, target, tier, statement
```

## Claim header and output

The header of each script declares:

| Field | Values |
|---|---|
| `target` | `static` (nothing deployed), `floci` (the local emulator) or `aws` (a real account) |
| `tier` | `any`, `light`, `production` or `production-ha` |
| `summary` | the statement it proves |
| `order` | optional, 50 by default: within a target, lower runs first |

The runner runs static claims first, then Floci, then AWS, so the cheap ones
fail fast.

It prints exactly one line:

```
CLAIM claim=<name> verdict=pass|caught|fail|pending [detail]
```

`pending` means the claim can't run here or yet, and the detail says what it
needs. A [Floci](/loomster/concepts/glossary/#floci) claim also says what Floci can't prove; IAM is the usual one,
since the emulator doesn't enforce it.

## BREAK

The runner runs every claim twice: plain, and with `BREAK=1`. Under `BREAK=1` the
claim breaks its own property on purpose (unsets the variable, drops the
component, denies the IAM action) and must print `caught`. A claim that still
prints `pass` there can't fail, and the runner records it as `fail`.

`just claims` writes a row per claim and run (claim, target, [tier](/loomster/concepts/glossary/#tier), run, verdict,
detail, time, git sha) to `test/claims-record.json`, which is committed, and
rewrites the table on [Validation](/loomster/reference/validation/) from it
(`npm run claims:page`). The docs check fails when the page and the record
disagree, so the status page only states what a recorded run showed.

## The gate and grants

Static claims run as they are. `floci` and `aws` claims, and the E2E scripts in
`test/`, hold real infrastructure, so they stop at a human gate
(`test/human-gate.sh`): a person types `run` in their own terminal. Anything
without a terminal, a coding agent included, gets exit code 3. CI runs pass.

To let an agent run particular claims, grant them:

```
just grant backend/deploy-agent            # 2 runs, for 4 hours
just grant backend --runs 1 --hours 2      # every backend/ claim
just grant e2e/production-live             # an E2E script
just grant --show                          # what is left
just grant --end
```

The agent can then run exactly those, one run at a time. A granted run that
writes nothing for 5 minutes (`LOOM_STALL_SECONDS`), or outlives the grant,
stops itself and says where it went quiet.

## Real AWS

Before an `aws` claim, a spend guard (`test/claims-aws.sh guard`) refuses unless
an AWS Budgets cost budget alerts at $10 or less (`LOOM_CLAIMS_ALERT_USD`) and
this month's spend is under $25 (`LOOM_CLAIMS_SPEND_CAP_USD`). Claims deploy
with `LOOM_ENV=claims` under the prefix `loom-claims-<instance>`, and after the
run `test/claims-aws.sh cleanup` lists, then deletes, everything carrying that
prefix (`LOOM_CLAIMS_KEEP=1` keeps it up). Every `aws` claim needs
`LOOM_CLAIMS_ACCOUNT_ID` set to the account your credentials resolve to, so a
claim never deploys into an account by accident.

The `aws` claims of one run share one deployment. Each asks for the components
it needs (`claims_aws_ensure` in `test/claims-aws.sh`), which deploys those and
what they depend on, unless an earlier claim in the run already did, and the
one cleanup at the end removes it all: the stacks, the tunnel host and
per-agent role stacks, the agents, memories and A2A agents Loom created
through its API, and the runtimes on the claims
[instance](/loomster/concepts/glossary/#instance)'s roles. A claim's `BREAK`
undoes itself on exit, so it never breaks a later claim.

| Claim | Deploys or uses |
|---|---|
| `ops/bootstrap` | nothing (account-level roles only) |
| `tier/light-live` | every component but `loom-agents` |
| `screens/all`, `backend/deploy-agent`, `agents/per-agent-role` | `loom-backend` and its dependencies |
| `agents/ready-and-invoke` | adds `loom-agents` |
| `tunnel/rds`, `db/baseline` | adds the tunnel host; need the Session Manager plugin |

Run them together, so the deployment is made once:

```
just grant ops tier screens backend/deploy-agent agents tunnel db/baseline
LOOM_CLAIMS_ACCOUNT_ID=<account> just claims ops,tier,screens,backend/deploy-agent,agents,tunnel,db/baseline
```

The claims' own [chant](/loomster/concepts/glossary/#chant) runs (component
deploys, [Op](/loomster/concepts/glossary/#op) runs) write their lifecycle
records to a scratch clone of the repository with no remote, not to this
repository's `chant/lifecycle`, and the cleanup deletes it. Claims that pass a
yodel gate (`db/baseline`, `db/migrate-local`) approve the plan in a scratch
copy of `db/` with its own repository, the way a person's `just db approve`
would record it; the real gates and ledger are never touched.

## Adding a claim

Add `test/claims/<area>/<part>.sh` with the header and the one-line output, and
give the source paths it depends on a line in `test/claim-paths.txt` so
`just claims-affected` picks it up. The runner needs no edit.
