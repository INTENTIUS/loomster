import { describe, test, expect } from "vitest";
import type { OpConfig } from "@intentius/chant/op";
import teardownOp from "./loom-teardown.op";
import { TEARDOWN_ORDER } from "./lib/teardown-plan";

function configOf(op: typeof teardownOp): OpConfig {
  return (op as unknown as { props: OpConfig }).props;
}

describe("loom-teardown.op — gated, owned-only, marker-scoped, no foreign deletes (chant#905)", () => {
  const config = configOf(teardownOp);

  test("gates before anything is deleted", () => {
    expect(config.phases[0].name).toBe("Approve");
    expect(config.phases[0].steps[0]).toMatchObject({ kind: "gate", signalName: "approve-loom-teardown" });
  });

  test("deletes every stack, in TEARDOWN_ORDER, sequentially (not parallel)", () => {
    const teardownPhase = config.phases.find((p) => p.name === "Teardown")!;
    expect(teardownPhase.parallel).toBeFalsy();
    expect(teardownPhase.steps).toHaveLength(TEARDOWN_ORDER.length);
    for (const [i, stackName] of TEARDOWN_ORDER.entries()) {
      const step = teardownPhase.steps[i] as { args?: { cmd?: string } };
      expect(step.args?.cmd).toContain(`--stack-name "${stackName}"`);
    }
  });

  test("no onFailure — a gated delete is not saga-compensated", () => {
    expect(config.onFailure).toBeUndefined();
  });
});
