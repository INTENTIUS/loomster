import { describe, test, expect } from "vitest";
import { NO_TARGET, SCREEN_CHECKS, type Profile, type FetchResult, type Seen } from "./checks";

function checkFor(screen: string) {
  const c = SCREEN_CHECKS.find((x) => x.screen === screen);
  if (!c) throw new Error(`no check named ${screen}`);
  return c;
}

const res = (status: number, body: unknown): FetchResult => ({ status, body });
const seenOf = (by: Record<string, unknown>): Seen => (path) => (path in by ? res(200, by[path]) : undefined);
const nothingSeen: Seen = () => undefined;
const run = (screen: string, profile: Profile, r: FetchResult, seen: Seen = nothingSeen) => checkFor(screen).check(profile, r, seen);
const pathOf = (screen: string, seen: Seen) => {
  const p = checkFor(screen).path;
  return typeof p === "string" ? p : p(seen);
};

describe("per-screen checks", () => {
  test("a non-200 fails every check loudly", () => {
    const r = run("Security — IAM roles", "demo", res(500, undefined));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("HTTP 500");
  });

  test("status 0 reports unreachable", () => {
    expect(run("Agents (Builder)", "demo", res(0, undefined)).detail).toBe("unreachable");
  });

  test("platform tags: passes only when all three keys are present", () => {
    const withAll = [{ key: "loom:application" }, { key: "loom:group" }, { key: "loom:owner" }];
    expect(run("Tagging — platform tags", "demo", res(200, withAll)).ok).toBe(true);
    const missing = [{ key: "loom:application" }, { key: "loom:owner" }];
    const r = run("Tagging — platform tags", "demo", res(200, missing));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("loom:group");
  });

  test("security roles: foundation/demo require >=1, none tolerates empty", () => {
    expect(run("Security — IAM roles", "foundation", res(200, [])).ok).toBe(false);
    expect(run("Security — IAM roles", "demo", res(200, [])).ok).toBe(false);
    expect(run("Security — IAM roles", "none", res(200, [])).ok).toBe(true);
    expect(run("Security — IAM roles", "foundation", res(200, [{ id: 1 }])).ok).toBe(true);
  });

  test("authorizers: foundation/demo require >=1", () => {
    expect(run("Security — authorizers", "foundation", res(200, [])).ok).toBe(false);
    expect(run("Security — authorizers", "foundation", res(200, [{ id: 1 }])).ok).toBe(true);
    expect(run("Security — authorizers", "none", res(200, [])).ok).toBe(true);
  });

  test("MCP: only the demo profile requires a seeded server", () => {
    expect(run("MCP Servers", "demo", res(200, [])).ok).toBe(false);
    expect(run("MCP Servers", "demo", res(200, [{ name: "Demo Echo MCP" }])).ok).toBe(true);
    expect(run("MCP Servers", "foundation", res(200, [])).ok).toBe(true);
  });

  test("Catalog sections (A2A / Memory / Agents) must be non-empty on demo, tolerant on foundation", () => {
    for (const screen of ["A2A Agents", "Memory", "Agents (Builder)"]) {
      expect(run(screen, "demo", res(200, [])).ok).toBe(false); // demo: empty section fails
      expect(run(screen, "foundation", res(200, [])).ok).toBe(true); // foundation: empty is fine
      expect(run(screen, "demo", res(200, {})).ok).toBe(false); // not an array
    }
  });

  test("Agents on demo: a live agent passes, all-FAILED fails (catches a broken deploy)", () => {
    expect(run("Agents (Builder)", "demo", res(200, [{ status: "READY" }])).ok).toBe(true);
    expect(run("Agents (Builder)", "demo", res(200, [{ status: "CREATING" }])).ok).toBe(true);
    const r = run("Agents (Builder)", "demo", res(200, [{ status: "FAILED" }, { status: "FAILED" }]));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("FAILED");
    // a live one alongside failed ones still passes
    expect(run("Agents (Builder)", "demo", res(200, [{ status: "FAILED" }, { status: "READY" }])).ok).toBe(true);
  });

  test("runtime-only screens pass on a 200 regardless of body", () => {
    for (const screen of ["Costs", "Admin (audit)", "Settings", "Registry"]) {
      expect(run(screen, "foundation", res(200, {})).ok).toBe(true);
      expect(run(screen, "foundation", res(404, undefined)).ok).toBe(false);
    }
  });

  test("Costs on demo requires recorded invocations (runtime dashboards populated)", () => {
    expect(run("Costs", "demo", res(200, { total_invocations: 0 })).ok).toBe(false);
    expect(run("Costs", "demo", res(200, { total_invocations: 3 })).ok).toBe(true);
    // foundation only needs it to render
    expect(run("Costs", "foundation", res(200, { total_invocations: 0 })).ok).toBe(true);
  });

  test("Security tabs: approval policies required on demo; identity providers only renders", () => {
    expect(run("Security — approval policies", "demo", res(200, [])).ok).toBe(false);
    expect(run("Security — approval policies", "demo", res(200, [{ id: 1 }])).ok).toBe(true);
    // identity providers is deliberately unseeded — empty passes on every profile
    expect(run("Security — identity providers", "demo", res(200, [])).ok).toBe(true);
  });

  test("covers every main screen + Security tab (Catalog is derived from its constituents)", () => {
    expect(SCREEN_CHECKS.length).toBe(24);
    // no duplicate endpoints among the fixed ones
    const fixed = SCREEN_CHECKS.map((c) => c.path).filter((p): p is string => typeof p === "string");
    expect(new Set(fixed).size).toBe(fixed.length);
  });

  test("a check whose path builds on an earlier screen comes after it", () => {
    const index = (screen: string) => SCREEN_CHECKS.findIndex((c) => c.screen === screen);
    for (const later of ["Agents — evaluations", "Agents — evaluators", "Agents — evaluation test cases"]) {
      expect(index(later)).toBeGreaterThan(index("Agents (Builder)"));
    }
    expect(index("Skills")).toBeGreaterThan(index("Settings — registry"));
    expect(index("Skills — dependents")).toBeGreaterThan(index("Skills"));
  });
});

describe("checks added for Loom v1.7 to v1.9 (#15)", () => {
  const agents = { "/api/agents": [{ id: 3, name: "someone_elses" }, { id: 7, name: "loomster_demo_agent" }] };

  test("POST-only routes pass on 405 (mounted, not triggered) and fail on 404", () => {
    for (const screen of ["Settings — models refresh", "Agents — model invoke-test"]) {
      expect(run(screen, "demo", res(405, undefined)).ok).toBe(true);
      expect(run(screen, "demo", res(404, undefined)).ok).toBe(false);
      expect(run(screen, "demo", res(200, {})).ok).toBe(false);
    }
  });

  test("approval logs live under /api/settings, and render on any profile", () => {
    expect(pathOf("Security — approval logs", nothingSeen)).toBe("/api/settings/approvals/logs");
    expect(run("Security — approval logs", "demo", res(200, [])).ok).toBe(true);
  });

  test("per-agent evaluation tabs open the demo agent, else the first listed", () => {
    expect(pathOf("Agents — evaluation test cases", seenOf(agents))).toBe("/api/agents/7/evaluations/test-cases");
    expect(pathOf("Agents — evaluations", seenOf({ "/api/agents": [{ id: 3, name: "x" }] }))).toBe("/api/agents/3/evaluations");
    expect(pathOf("Agents — evaluators", seenOf({ "/api/agents": [] }))).toBeUndefined();
  });

  test("with no agent to open: demo fails, other profiles skip", () => {
    const none = res(NO_TARGET, undefined);
    expect(run("Agents — evaluations", "demo", none).ok).toBe(false);
    expect(run("Agents — evaluations", "foundation", none).ok).toBe(true);
  });

  test("evaluation test cases: demo needs a seeded case that has run", () => {
    expect(run("Agents — evaluation test cases", "demo", res(200, [])).ok).toBe(false);
    expect(run("Agents — evaluation test cases", "demo", res(200, [{ id: 1, last_run_at: null }])).ok).toBe(false);
    expect(run("Agents — evaluation test cases", "demo", res(200, [{ id: 1, last_run_at: "2026-10-12T00:00:00" }])).ok).toBe(true);
    expect(run("Agents — evaluation test cases", "foundation", res(200, [])).ok).toBe(true);
  });

  test("Skills: the demo skill is required only when a registry is configured", () => {
    const on = seenOf({ "/api/settings/registry": { enabled: true, registry_id: "r1" } });
    const off = seenOf({ "/api/settings/registry": { enabled: false, registry_id: "" } });
    expect(run("Skills", "demo", res(200, []), off).ok).toBe(true);
    expect(run("Skills", "demo", res(200, []), on).ok).toBe(false);
    expect(run("Skills", "demo", res(200, [{ name: "loomster-demo-skill", status: "DRAFT" }]), on).ok).toBe(false);
    expect(run("Skills", "demo", res(200, [{ name: "loomster-demo-skill", status: "APPROVED" }]), on).ok).toBe(true);
  });

  test("Skills dependents: opens the demo skill and, on demo, needs the demo agent attached", () => {
    const seen = seenOf({
      "/api/settings/registry": { enabled: true },
      "/api/registry/records?descriptor_type=SKILL": [{ record_id: "other" }, { record_id: "rec 1", name: "loomster-demo-skill" }],
    });
    expect(pathOf("Skills — dependents", seen)).toBe("/api/registry/records/rec%201/dependents");
    expect(run("Skills — dependents", "demo", res(200, { dependents: [] }), seen).ok).toBe(false);
    expect(run("Skills — dependents", "demo", res(200, { dependents: [{ agent_id: 7, agent_name: "loomster_demo_agent" }] }), seen).ok).toBe(true);
    // no skill record (no registry): nothing to open, not a failure
    expect(run("Skills — dependents", "demo", res(NO_TARGET, undefined)).ok).toBe(true);
  });
});
