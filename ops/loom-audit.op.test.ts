/**
 * Unit coverage for the supply-chain audit Op (chant#906) — mirrors
 * `ops/lifecycle.test.ts`'s pattern for `loom-watch`/`loom-reconcile`: prove
 * this repo's own wiring (name, phase shape, no schedule) as authored in
 * `./loom-audit.op.ts`, since `WorkflowAuditOp` itself is covered by
 * `@intentius/chant-lexicon-temporal`'s own test suite.
 */

import { describe, test, expect } from "vitest";
import type { OpConfig } from "@intentius/chant/op";
import auditOpDefault from "./loom-audit.op";

function configOf(op: unknown): OpConfig {
  return (op as { props: OpConfig }).props;
}

describe("loom-audit.op — WorkflowAuditOp wiring (chant#906)", () => {
  const config = configOf(auditOpDefault);

  test("named loom-audit — discovered by `chant run loom-audit`", () => {
    expect(config.name).toBe("loom-audit");
  });

  test("Audit phase runs workflowSupplyChainAudit against .github/workflows in report mode", () => {
    const [auditPhase] = config.phases;
    expect(auditPhase.name).toBe("Audit");
    const [auditStep] = auditPhase.steps as Array<{ fn?: string; args?: Record<string, unknown>; outcomeAttribute?: unknown }>;
    expect(auditStep.fn).toBe("workflowSupplyChainAudit");
    expect(auditStep.args).toEqual({ workflowsDir: ".github/workflows", mode: "report" });
    expect(auditStep.outcomeAttribute).toEqual({ name: "Findings", from: "findings" });
  });

  test("one-shot only — as authored, no schedule export exists (CI-cron is the only scheduled trigger, chant#906)", () => {
    const opModule = auditOpDefault as unknown as Record<string, unknown>;
    expect(opModule.schedule).toBeUndefined();
  });

  test("no gate, no onFailure — a stateless observe Op, unlike the durable/gated Ops (chant#905)", () => {
    expect(config.phases.some((p) => p.steps.some((s) => (s as { kind?: string }).kind === "gate"))).toBe(false);
    expect(config.onFailure).toBeUndefined();
  });
});
