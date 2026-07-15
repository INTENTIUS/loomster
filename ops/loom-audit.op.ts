/**
 * Supply-chain audit of this repo's own emitted GitHub Actions workflows
 * (chant#906, part of the #903 lifecycle umbrella under epic #885).
 *
 * `WorkflowAuditOp` resolves every pinned `uses:` reference under
 * `.github/workflows/` against live upstream truth — stale SHA pins,
 * impostor refs, archived upstreams, disclosed advisories — the live
 * counterpart to the deterministic GHA02x-05x post-synth checks chant
 * already runs at `chant build` time. It sits at **observe** on the
 * lifecycle dial, the same position as `./loom-watch.op.ts`.
 *
 * `onFinding: "report"` only. `WorkflowAuditOp` accepts `"issue"`/
 * `"pull-request"` too, but as of this writing the underlying
 * `workflowSupplyChainAudit` activity (`@intentius/chant-lexicon-temporal`)
 * only returns the findings + a markdown summary — it does not yet open the
 * issue/PR itself (unlike `reconcilePr`, which does). Pick a write mode here
 * once that activity closes the gap; until then it would silently do
 * nothing beyond `report`.
 *
 * One-shot on the local executor only — no `schedule` is passed, so `chant
 * build ops` emits no `TemporalSchedule` for this Op. Unlike `loom-watch`/
 * `loom-reconcile` (scheduled on both Temporal and CI-cron), this concern is
 * CI-cron only: see `.github/workflows/audit.yml` and the per-operation-
 * backend doctrine settled on chant#906 (CI-cron is one trigger host among
 * several — nothing requires also wiring every stateless concern through
 * Temporal).
 *
 *   chant run loom-audit
 */
import { WorkflowAuditOp } from "@intentius/chant-lexicon-temporal";

const { op } = WorkflowAuditOp({
  name: "loom-audit",
  onFinding: "report",
});

export default op; // discovered by `chant run loom-audit`
