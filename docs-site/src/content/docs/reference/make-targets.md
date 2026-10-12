---
title: Loom make targets
description: Each operator target in Loom's backend and shared makefiles, and the loomster verb or chant Op that does the same job.
---

Loom's makefiles (`backend/makefile`, `shared/makefile` at v1.9.0) carry the
operator tasks you run against a deployment. loomster has a verb for each one,
usually a [chant](/loomster/concepts/glossary/#chant) [Op](/loomster/reference/ops/).
[Coming from Loom's SAM deploy](/loomster/guides/coming-from-upstream-loom/) maps
the deploy targets.
Where Loom reads `etc/environment.sh`, loomster resolves the same inputs from
the deployment itself: names from the naming helper, ids from stack outputs.
You pass only what loomster can't know, such as a memory id.

Anything that touches the database runs as a one-off ECS task of the live
backend: same image, task role, environment and network as the service. The
database stays private, and its credentials never reach your shell.

## The mapping

| Loom target | loomster | Op | Gated |
|---|---|---|---|
| `make migrate` (`migrate-db` + `fix-sequences`) | `just import-sqlite <loom.db>` | `loom-import-sqlite` | Yes, never over MCP |
| `make fix-sequences` | `just fix-sequences` | `loom-fix-sequences` | No |
| `make reset-db` | `just reset-db` | `loom-reset-db` | Yes, never over MCP |
| `make refresh-models` | Bump the Loom pin (see below) | none | |
| `make agentcore.credentials.list` | `just credentials` | `loom-credentials` | No |
| `make agentcore.credentials.delete-all` | `just credentials-delete` (owned-only) | `loom-credentials-delete` | Yes, never over MCP |
| `make agentcore.memory.list` | `just memory` | `loom-memory` | No |
| `make agentcore.memory.get` | `just memory get <memory-id>` | `loom-memory` | No |
| `make agentcore.memory.records` | `just memory records <memory-id> <actor-id>` | `loom-memory` | No |
| `make agentcore.memory.records-by-namespace` | `just memory records-by-namespace <memory-id> <namespace>` | `loom-memory` | No |
| `make agentcore.memory.extraction-jobs` | `just memory extraction-jobs <memory-id>` | `loom-memory` | No |
| `make cognito.set-passwords` | `LOOM_COGNITO_PASSWORD=... just set-passwords [alice,bob]` | `loom-cognito-set-passwords` | No, never over MCP |
| `make cognito.get-client-id` | `just cognito-client-id` | none | |
| `make cognito.get-tokens` | `just cognito-token` | none | |
| `make ecs.init`, `make agentcore.init` | `just bootstrap` | `loom-bootstrap` | No |
| `make ec2` + `make tunnel` | `just tunnel-host`, then `just tunnel` ([guide](/loomster/guides/open-a-tunnel-to-the-database/)) | `loom-tunnel-host` | No |
| `make ci-role` | Not ported (see below) | | |

A gated Op takes a snapshot or prints its plan first, then stops at its gate
with exit 3. Approve it and run the same verb again:

```
just reset-db                                  # snapshot, then exit 3
chant approve loom-reset-db approve-loom-reset-db
just reset-db                                  # wipes the schema, rolls the backend
```

"Never over MCP" means a coding agent connected to chant's MCP server can't
run the Op or approve its gate. People run it with `chant run` and
`chant approve`.

## Differences from Loom

**Importing a SQLite Loom.** `make migrate` copies `./loom.db` into
`LOOM_DATABASE_URL` from your laptop. loomster uploads the file to the
deployment's artifact bucket, imports it from a backend task inside the VPC,
runs `fix_sequences.py`, and deletes the upload. Like upstream, each table it
copies replaces that table's rows. Set `LOOM_IMPORT_SKIP_EXISTING=1` to keep
tables that already have data.

**Restore doesn't need fix-sequences.** `loom-restore` restores an RDS
snapshot or point in time, and that carries the sequences along with the data.
`loom-fix-sequences` is for rows loaded some other way.

**reset-db.** Upstream's `reset_db.py` asks for "yes" on stdin and prints the
whole database URL, password included. The Op runs the same `DROP SCHEMA
public CASCADE` without either: its gate is the confirmation, and it takes a
snapshot first. It then rolls the backend so `init_db()` recreates the tables.
Run `npm run seed` afterwards. Loom's AWS resources (agent runtimes,
credential providers) survive the reset. Remove them first, by deleting the
agents in the UI and running `just credentials-delete`, or they're orphaned.

**credentials delete-all is owned-only.** Upstream deletes every OAuth2
credential provider in the account. Loom names providers
`loom-<agent>-<agent id>-<kind>`, with no deployment marker, so that would also
delete another Loom [instance](/loomster/concepts/glossary/#instance)'s providers. `loom-credentials-delete` deletes
only the providers this Loom's database records: the same set Loom removes when
it deletes an agent, plus API-key providers for LiteLLM. `loom-teardown` runs
the same delete before it removes the stacks. `just credentials` shows both the
account-wide list and the owned list.

**Memory inspection uses the AWS CLI.** Upstream runs Python helpers from a
backend virtualenv. `loom-memory` makes the same calls with `aws` and `jq`, so
you don't need a venv.

**set-passwords takes a user list.** Upstream hard-codes its 22 demo users.
loomster creates no users unless you opt in (`demoSeed` on loom-cognito), so
name the users with `LOOM_COGNITO_USERS`. Leave it unset to cover every user
still in `FORCE_CHANGE_PASSWORD`. The password reaches the AWS CLI through a
temporary file, so it never shows up in the process list.

**cognito-token signs in as a throwaway admin.** Upstream signs in as `admin`
with a password from `etc/environment.sh`. `just cognito-token` creates (or
recreates) an `e2e-validator` user in the admin groups, completes the MFA setup
when the pool requires MFA (`LOOM_COGNITO_MFA=ON`), and prints its access token.
Run `just cognito-token --delete` when you're done. It works on every
[tier](/loomster/concepts/glossary/#tier), since every tier has the user app client.

## Not ported

**refresh-models.** Loom's model catalog (`etc/models.json`) is part of the
image. On ECS the Settings refresh can't write it: the file is root-owned, the
backend runs as a non-root user, and every task has its own copy anyway. The
list updates when you bump the Loom pin (`scripts/vendor-loom.sh`), which
rebuilds the image with that release's catalog. See the
[upgrade guide](/loomster/guides/upgrade-loom/).

**ci-role.** `shared/makefile` deploys a CI role from `P_CI_ROLE_TEMPLATE`, but
Loom doesn't ship that template. loomster's generated pipelines use their own
OIDC role setup ([CI providers](/loomster/reference/ci/)).
