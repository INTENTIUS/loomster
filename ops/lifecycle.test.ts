/**
 * Unit coverage for the observe + reconcile lifecycle Ops (chant#904).
 *
 * `WatchOp`/`ReconcileOp` themselves are exercised by
 * `@intentius/chant-lexicon-temporal`'s own test suite — these tests cover
 * this repo's own wiring: the per-env dial (chant#890 — light observes only,
 * production/production-ha additionally reconcile on a schedule), the
 * search-attribute registrations, and that the two `*.op.ts` files as
 * authored produce the expected shape under this process's environment.
 */

import { describe, test, expect } from "vitest";
import { WatchOp, ReconcileOp } from "@intentius/chant-lexicon-temporal";
import { reconcilesOnScheduleForTier } from "./params";
import * as searchAttrs from "./search-attributes";
import watchOpDefault, { loomWatchSchedule } from "./loom-watch.op";
import reconcileOpDefault, { loomReconcileSchedule } from "./loom-reconcile.op";
import type { Tier } from "../src/lib/naming";

const TIERS: readonly Tier[] = ["light", "production", "production-ha"];

function opProps(op: unknown): Record<string, unknown> {
  return (op as { props: Record<string, unknown> }).props;
}

function phaseSteps(op: unknown, phaseName: string): Array<Record<string, unknown>> {
  const phases = opProps(op).phases as Array<{ name: string; steps: Array<Record<string, unknown>> }>;
  const found = phases.find((p) => p.name === phaseName);
  if (!found) throw new Error(`no ${phaseName} phase`);
  return found.steps;
}

describe("chant#890 per-env dial — reconcilesOnScheduleForTier", () => {
  test("light observes only: no scheduled reconcile", () => {
    expect(reconcilesOnScheduleForTier("light")).toBe(false);
  });

  test("production reconciles on a schedule", () => {
    expect(reconcilesOnScheduleForTier("production")).toBe(true);
  });

  test("production-ha reconciles on a schedule", () => {
    expect(reconcilesOnScheduleForTier("production-ha")).toBe(true);
  });
});

describe("loom-watch — WatchOp wiring", () => {
  for (const tier of TIERS) {
    test(`${tier}: always scheduled — every tier observes (chant#890)`, () => {
      const { schedule } = WatchOp({ name: "loom-watch", env: "test", schedule: "*/15 * * * *", live: true });
      expect(schedule).toBeDefined();
      expect(opProps(schedule).scheduleId).toBe("loom-watch-schedule");
    });
  }

  test("Diff phase runs chant lifecycle diff --live and captures Drift", () => {
    const { op } = WatchOp({ name: "loom-watch", env: "prod", schedule: "*/15 * * * *", live: true });
    const [diffStep] = phaseSteps(op, "Diff");
    expect(diffStep.fn).toBe("lifecycleDiff");
    expect(diffStep.args).toEqual({ env: "prod", live: true });
    expect(diffStep.outcomeAttribute).toEqual({ name: "Drift", from: "drifted" });
  });

  test("as authored (ops/loom-watch.op.ts): default-exports the Op, always exports a schedule", () => {
    expect(opProps(watchOpDefault).name).toBe("loom-watch");
    expect(loomWatchSchedule).toBeDefined();
    expect(opProps(loomWatchSchedule).scheduleId).toBe("loom-watch-schedule");
  });
});

describe("loom-reconcile — ReconcileOp wiring", () => {
  for (const tier of TIERS) {
    const expectScheduled = reconcilesOnScheduleForTier(tier);

    test(`${tier}: scheduled reconcile is ${expectScheduled ? "present" : "absent"} (chant#890 dial)`, () => {
      const { schedule } = ReconcileOp({
        name: "loom-reconcile",
        env: "test",
        schedule: expectScheduled ? "0 * * * *" : undefined,
        onDrift: "pull-request",
        scope: { owned: true },
      });
      if (expectScheduled) {
        expect(schedule).toBeDefined();
        expect(opProps(schedule as unknown).scheduleId).toBe("loom-reconcile-schedule");
      } else {
        expect(schedule).toBeUndefined();
      }
    });
  }

  test("owned-only scope, pull-request mode, never touches main (reconcilePr activity args)", () => {
    const { op } = ReconcileOp({ name: "loom-reconcile", env: "prod", onDrift: "pull-request", scope: { owned: true } });
    const [reconcileStep] = phaseSteps(op, "Reconcile");
    expect(reconcileStep.fn).toBe("reconcilePr");
    expect(reconcileStep.args).toEqual({ env: "prod", mode: "pull-request", owned: true });
    expect(reconcileStep.outcomeAttribute).toEqual({ name: "PR", from: "prUrl" });
  });

  test("as authored (ops/loom-reconcile.op.ts): default-exports the Op, matches this process's tier dial", () => {
    expect(opProps(reconcileOpDefault).name).toBe("loom-reconcile");
    // This test process's LOOM_TIER is unset -> "light" -> observe-only, so
    // the authored file's own schedule export should be absent.
    expect(loomReconcileSchedule).toBeUndefined();
  });
});

describe("search-attributes — server-side registration (chant#904 acceptance: Watch/Env/Drift/OpName)", () => {
  const REQUIRED: Array<[string, keyof typeof searchAttrs]> = [
    ["OpName", "opNameAttr"],
    ["Watch", "watchAttr"],
    ["Env", "envAttr"],
    ["Drift", "driftAttr"],
    ["Reconcile", "reconcileAttr"],
    ["PR", "prAttr"],
  ];

  for (const [name, exportName] of REQUIRED) {
    test(`${name} is registered as a Keyword SearchAttribute`, () => {
      const attr = searchAttrs[exportName];
      const props = opProps(attr);
      expect(props.name).toBe(name);
      expect(props.type).toBe("Keyword");
    });
  }
});
