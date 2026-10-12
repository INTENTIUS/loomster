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

## What a claim declares and prints

The header of each script declares:

| Field | Values |
|---|---|
| `target` | `static` (nothing deployed), `floci` (the local emulator) or `aws` (a real account) |
| `tier` | `any`, `light`, `production` or `production-ha` |
| `summary` | the statement it proves |

It prints exactly one line:

```
CLAIM claim=<name> verdict=pass|caught|fail|pending [detail]
```

`pending` means the claim can't run here or yet, and the detail says what it
needs. A Floci claim also says what Floci can't prove; IAM is the usual one,
since the emulator doesn't enforce it.

## BREAK

The runner runs every claim twice: plain, and with `BREAK=1`. Under `BREAK=1` the
claim breaks its own property on purpose (unsets the variable, drops the
component, denies the IAM action) and must print `caught`. A claim that still
prints `pass` there can't fail, and the runner records it as `fail`.

`just claims` writes a row per claim and run (claim, target, tier, run, verdict,
detail, time, git sha) to `test/.state/claims.json`.

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
prefix (`LOOM_CLAIMS_KEEP=1` keeps it up). `backend/deploy-agent` also needs
`LOOM_CLAIMS_ACCOUNT_ID` set to the account your credentials resolve to.

## Adding a claim

Add `test/claims/<area>/<part>.sh` with the header and the one-line output, and
give the source paths it depends on a line in `test/claim-paths.txt` so
`just claims-affected` picks it up. The runner needs no edit.
