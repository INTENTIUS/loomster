/**
 * Reconcile position of the lifecycle dial (chant#904, part of the #903
 * lifecycle umbrella under epic #885).
 *
 * `ReconcileOp`, owned-only: when the live Loom deployment drifts from this
 * repo's source, open a cloud → code PR that regenerates the affected
 * TypeScript via live import. It only ever changes source — never commits
 * to main, never mutates the cloud. `scope: { owned: true }` restricts
 * reconciliation to resources carrying chant's ownership marker
 * (`chant.config.ts`'s `ownership` field, chant#897) — a foreign resource
 * is never touched.
 *
 * Per-env dial (chant#890): `light` observes only — `reconcilesOnSchedule`
 * is false there, so the Op carries no `schedule`. `production`/
 * `production-ha` additionally get an hourly scheduled reconcile. Every tier
 * can still run a one-shot reconcile:
 *
 *   chant run loom-reconcile
 */
import { ReconcileOp } from "@intentius/chant/op";
import { loomEnv, reconcilesOnSchedule } from "./params";

const { op } = ReconcileOp({
  name: "loom-reconcile",
  env: loomEnv,
  schedule: reconcilesOnSchedule ? "0 * * * *" : undefined, // hourly — production/production-ha only
  onDrift: "pull-request",
  scope: { owned: true },
});

export default op; // discovered by `chant run loom-reconcile`
