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

See `../../../docs/adoption.md` for the full adoption matrix (every seam,
its default, what replacing it requires) and the known gaps this example
deliberately documents rather than hides.

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

`loom-backend`/`loom-frontend` build clean end to end. `shared-foundation`
currently fails `chant build`'s post-synth check on a pre-existing,
unrelated gap: the artifact bucket has no explicit Deny-non-TLS policy
(WAW042) — this reproduces identically against the repo's real,
unmodified `src/shared-foundation` stack, so it isn't something this
example introduced (see docs/adoption.md's "Known gaps").

`loom-db`/`loom-cognito`/`loom-cognito-second-instance` are fully
`reference-existing` — they provision nothing of their own, so there is no
lexicon-tagged resource in those directories for `chant build --lexicon aws`
to emit standalone (a pure-outputs stack is meant to be consumed by a
downstream `stackOutput(...)`, not built alone). Their correctness is
proven instead in `./adoption.test.ts`, via the same
`expandComposite`/`resolveAttrRefs`/`awsSerializer.serialize` pipeline every
composite's own unit tests use.

## Known gaps (see docs/adoption.md for the full writeup)

- `LoomBackend`/`LoomFrontend` always provision their own ECS execution/task
  IAM roles — there is no `reference-existing` seam for those yet, unlike
  every upstream piece they depend on.
- PrivateLink (`shared-foundation`) is gated purely by tier, not an
  independent seam — there is no way to omit it on `production`/
  `production-ha` without also giving up the full tier.
- No bastion composite exists in this codebase (Loom's own upstream template
  has none either) — nothing to reference or omit.
