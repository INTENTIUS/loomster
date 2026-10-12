# Bring-your-own-everything (chant#898)

A runnable adoption example: every referenceable seam across the five Loom
composites set to `reference-existing`, pointed at resources a platform
team already owns — a pre-existing VPC (with public/private subnets by
tier), a pre-existing KMS key, pre-existing ACM cert + Route53 zone,
pre-existing ECR repos, a pre-existing AgentCore execution role, an
externally-managed Postgres endpoint, and a shared org-level Cognito pool
referenced by **two** independent Loom instances.

**Zero edits to any composite.** Every file here either calls
`../../composites/*.ts` directly with reference-existing props, or imports
one of this directory's own sibling modules. Nothing under
`src/composites/` changed to make this example work — that's the point:
adoption is parameter choice, not a fork.

See https://intentius.io/loomster/reference/adoption-seams/ for every seam, its
default and what replacing it requires, and
https://intentius.io/loomster/guides/bring-your-own-everything/ for a walkthrough
of this example.

## Layout

| Directory | Composite | Seam(s) exercised |
|---|---|---|
| `shared-foundation/` | `SharedFoundation` (chant#886) | `network`, `kms`, `ecr`, `route53`, `acm`, `agentRole` — all `reference-existing` |
| `loom-db/` | `LoomDb` (chant#887) | `data: reference-existing` — external Postgres endpoint |
| `loom-cognito/` | `LoomCognito` (chant#888) | `identity: reference-existing` — shared org pool, first instance (`shared-a`) |
| `loom-cognito-second-instance/` | `LoomCognito` (chant#888) | Same pool as above, second independent instance (`shared-b`) — proves one pool, two Looms |
| `loom-backend/` | `LoomBackend` (chant#889) | Composes against the external cluster/target-group/DB-secret/Cognito-pool above |
| `loom-frontend/` | `LoomFrontend` (chant#889) | Composes against the external cluster/target-group above |

## Running it

```sh
npx chant build src/examples/byo/loom-backend --lexicon aws
npx chant build src/examples/byo/loom-frontend --lexicon aws
npx chant build src/examples/byo/shared-foundation --lexicon aws
```

All three build clean end to end.

`loom-db`/`loom-cognito`/`loom-cognito-second-instance` are fully
`reference-existing` — they provision nothing of their own, so there is no
lexicon-tagged resource in those directories for `chant build --lexicon aws`
to emit standalone (a pure-outputs stack is meant to be consumed by a
downstream `stackOutput(...)`, not built alone). Their correctness is
proven instead in `./adoption.test.ts`, via the same
`expandComposite`/`resolveAttrRefs`/`awsSerializer.serialize` pipeline every
composite's own unit tests use.

## Seams this example leaves at their defaults

- `loom-backend` and `loom-frontend` can also take existing IAM roles
  (`executionRoleArn`, `taskRoleArn`); this example lets them provision their own.
- PrivateLink follows the tier here; `privateLink.mode` (`LOOM_PRIVATELINK`)
  omits or adds it on any tier.
- The optional SSM tunnel host (`loom-tunnel-host`) is outside the component
  graph; to use a bastion you already run, open the database's security group
  to it.
