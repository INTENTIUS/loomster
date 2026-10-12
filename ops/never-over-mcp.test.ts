import { describe, test, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { OpConfig, PhaseDefinition } from "@intentius/chant/op";

/**
 * Agent safety (#25): an Op a person must start and approve carries
 * `neverOverMcp: true`, so `chant serve mcp`'s `op-run` refuses to start it and
 * `op-approve` refuses its gates. Every gated Op qualifies, and so do the
 * ungated ones that change a deployment in a way an agent shouldn't start on
 * its own.
 */

/** Ungated Ops an agent still must not start over MCP. */
const UNGATED_PERSON_ONLY = [
  "loom-restore-drill", // creates and deletes an RDS instance
  "loom-cognito-export", // exports every user record
  "loom-tunnel-host", // opens a path into the database
  "loom-cognito-set-passwords", // sets user passwords
  "loom-upgrade-light", // rolls the backend and migrates the schema
];

const OP_DIRS = [join(__dirname), join(__dirname, "../db/ops")];

function opFiles(): string[] {
  return OP_DIRS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".op.ts")).map((f) => join(dir, f)));
}

function configOf(mod: Record<string, unknown>): OpConfig {
  const op = (mod.default ?? mod.op) as { props: OpConfig };
  return op.props;
}

function hasGate(phases: PhaseDefinition[] | undefined): boolean {
  return (phases ?? []).some((p) =>
    p.steps.some((s) => s.kind === "gate" || (s.kind === "effect" && s.steps.some((n) => n.kind === "gate"))),
  );
}

describe("neverOverMcp (#25)", async () => {
  const ops = await Promise.all(opFiles().map(async (file) => configOf(await import(file))));

  test("every Op with a gate is never run or approved over MCP", () => {
    const gated = ops.filter((c) => hasGate(c.phases));
    expect(gated.length).toBeGreaterThan(5);
    for (const c of gated) expect({ op: c.name, neverOverMcp: c.neverOverMcp }).toEqual({ op: c.name, neverOverMcp: true });
  });

  test("the ungated Ops that change a deployment are never run over MCP either", () => {
    for (const name of UNGATED_PERSON_ONLY) {
      const c = ops.find((o) => o.name === name);
      expect(c, name).toBeDefined();
      expect({ op: name, neverOverMcp: c!.neverOverMcp }).toEqual({ op: name, neverOverMcp: true });
    }
  });

  test("read-only Ops stay available to an agent over MCP", () => {
    for (const name of ["loom-audit", "loom-credentials", "loom-memory", "loom-watch"]) {
      const c = ops.find((o) => o.name === name);
      expect(c, name).toBeDefined();
      expect(c!.neverOverMcp, name).toBeFalsy();
    }
  });
});
