import { describe, test, expect } from "vitest";
import { TEARDOWN_ORDER, deleteStackScript } from "./teardown-plan";

describe("TEARDOWN_ORDER (chant#905 — reverse dependency order)", () => {
  test("deletes every stack README.md's component table lists", () => {
    expect(new Set(TEARDOWN_ORDER)).toEqual(
      new Set(["shared-foundation", "loom-cognito", "loom-db", "loom-frontend", "loom-backend"]),
    );
  });

  test("loom-backend (the sole multi-dependency consumer) goes first", () => {
    expect(TEARDOWN_ORDER[0]).toBe("loom-backend");
  });

  test("nothing is deleted before what depends on it", () => {
    const indexOf = (name: string) => TEARDOWN_ORDER.indexOf(name);
    // loom-backend depends on shared-foundation, loom-db, loom-cognito.
    expect(indexOf("loom-backend")).toBeLessThan(indexOf("shared-foundation"));
    expect(indexOf("loom-backend")).toBeLessThan(indexOf("loom-db"));
    expect(indexOf("loom-backend")).toBeLessThan(indexOf("loom-cognito"));
    // loom-db and loom-frontend depend on shared-foundation.
    expect(indexOf("loom-db")).toBeLessThan(indexOf("shared-foundation"));
    expect(indexOf("loom-frontend")).toBeLessThan(indexOf("shared-foundation"));
  });
});

describe("deleteStackScript (chant#905 — owned-only, marker-scoped: the CFN stack boundary IS the marker)", () => {
  test("deletes exactly the named stack and waits for the delete to complete", () => {
    const script = deleteStackScript("loom-backend");
    expect(script).toBe(
      [
        "set -euo pipefail",
        `aws cloudformation delete-stack --stack-name "loom-backend"`,
        `aws cloudformation wait stack-delete-complete --stack-name "loom-backend"`,
        `echo "teardown: loom-backend deleted"`,
      ].join("\n"),
    );
  });

  test("never references any stack other than the one named", () => {
    const script = deleteStackScript("loom-db");
    for (const other of TEARDOWN_ORDER.filter((s) => s !== "loom-db")) {
      expect(script).not.toContain(other);
    }
  });
});
