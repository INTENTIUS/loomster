import { describe, test, expect } from "vitest";
import { SCREEN_CHECKS, type Profile, type FetchResult } from "./checks";

function checkFor(screen: string) {
  const c = SCREEN_CHECKS.find((x) => x.screen === screen);
  if (!c) throw new Error(`no check named ${screen}`);
  return c;
}

const res = (status: number, body: unknown): FetchResult => ({ status, body });
const run = (screen: string, profile: Profile, r: FetchResult) => checkFor(screen).check(profile, r);

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

  test("A2A / Memory / Agents pass on any array (just need to render)", () => {
    for (const screen of ["A2A Agents", "Memory", "Agents (Builder)"]) {
      expect(run(screen, "demo", res(200, [])).ok).toBe(true);
      expect(run(screen, "demo", res(200, {})).ok).toBe(false);
    }
  });

  test("runtime-only screens pass on a 200 regardless of body", () => {
    for (const screen of ["Costs", "Admin (audit)", "Settings", "Registry"]) {
      expect(run(screen, "foundation", res(200, {})).ok).toBe(true);
      expect(run(screen, "foundation", res(404, undefined)).ok).toBe(false);
    }
  });

  test("covers every main screen (Catalog is derived from its constituents)", () => {
    expect(SCREEN_CHECKS.length).toBe(12);
    // no duplicate endpoints
    expect(new Set(SCREEN_CHECKS.map((c) => c.path)).size).toBe(12);
  });
});
