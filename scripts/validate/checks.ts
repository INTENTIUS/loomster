/**
 * Per-screen validation checks (loomster#103 follow-up).
 *
 * "Validated" should mean something screen by screen: for a given seed profile,
 * every main Loom screen's data endpoint returns 200 AND holds what that profile
 * seeds. This module is the pure, unit-tested definition of that bar; `./run.ts`
 * fetches each endpoint against a live Loom and applies these checks.
 *
 * Endpoints are Loom's own (paths taken from `vendor/loom/backend/app/routers/`).
 * Screens whose content is runtime-only (Costs, Admin audit, Settings, Registry)
 * assert only that the screen renders (HTTP 200); screens Loom or `loom-seed`
 * populate assert the seeded shape per profile.
 */

export type Profile = "demo" | "foundation" | "none";

export interface FetchResult {
  /** HTTP status, or 0 if the request itself failed (unreachable). */
  status: number;
  /** Parsed JSON body, or undefined when the response wasn't JSON. */
  body: unknown;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface ScreenCheck {
  screen: string;
  path: string;
  check: (profile: Profile, res: FetchResult) => CheckResult;
}

const pass = (detail: string): CheckResult => ({ ok: true, detail });
const fail = (detail: string): CheckResult => ({ ok: false, detail });
const isArray = (b: unknown): b is unknown[] => Array.isArray(b);

/** Gate every check on a 200 first, so a 404/500 fails loudly rather than as a shape mismatch. */
function on200(res: FetchResult, then: () => CheckResult): CheckResult {
  return res.status === 200 ? then() : fail(res.status === 0 ? "unreachable" : `HTTP ${res.status}`);
}

/** foundation and demo both seed the security floor; none does not. */
function seedsSecurity(profile: Profile): boolean {
  return profile !== "none";
}

export const SCREEN_CHECKS: ScreenCheck[] = [
  {
    screen: "Tagging — platform tags",
    path: "/api/settings/tags",
    check: (_p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      // Field-name-tolerant: the three platform tag keys must appear somewhere in the payload.
      const s = JSON.stringify(res.body);
      const need = ["loom:application", "loom:group", "loom:owner"];
      const missing = need.filter((k) => !s.includes(k));
      return missing.length ? fail(`missing platform tags: ${missing.join(", ")}`) : pass(`${res.body.length} tags, all platform tags present`);
    }),
  },
  {
    screen: "Tagging — tag profiles",
    path: "/api/settings/tag-profiles",
    check: (_p, res) => on200(res, () => (isArray(res.body) && res.body.length >= 1 ? pass(`${res.body.length} profiles`) : fail("no tag profiles seeded"))),
  },
  {
    screen: "Security — IAM roles",
    path: "/api/security/roles",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (seedsSecurity(p)) return res.body.length >= 1 ? pass(`${res.body.length} managed roles`) : fail("no managed roles — agent role not imported (add-agent picker would be empty)");
      return pass(`${res.body.length} managed roles`);
    }),
  },
  {
    screen: "Security — authorizers",
    path: "/api/security/authorizers",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (seedsSecurity(p)) return res.body.length >= 1 ? pass(`${res.body.length} authorizers`) : fail("no authorizer configured (add-agent authorizer picker would be empty)");
      return pass(`${res.body.length} authorizers`);
    }),
  },
  {
    screen: "MCP Servers",
    path: "/api/mcp/servers",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p === "demo") return res.body.length >= 1 ? pass(`${res.body.length} MCP servers`) : fail("demo profile: no sample MCP server seeded");
      return pass(`${res.body.length} MCP servers`);
    }),
  },
  {
    // The Catalog aggregates agents + memories + MCP + A2A; on the demo profile
    // every one of those sections must be non-empty, or the Catalog reads as
    // broken. So A2A/Memory/Agents require >=1 on demo (not just "renders").
    screen: "A2A Agents",
    path: "/api/a2a/agents",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p === "demo") return res.body.length >= 1 ? pass(`${res.body.length} A2A agents`) : fail("demo profile: no A2A agent seeded (Catalog section empty)");
      return pass(`${res.body.length} A2A agents`);
    }),
  },
  {
    screen: "Memory",
    path: "/api/memories",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p === "demo") return res.body.length >= 1 ? pass(`${res.body.length} memories`) : fail("demo profile: no memory seeded (Catalog section empty)");
      return pass(`${res.body.length} memories`);
    }),
  },
  {
    screen: "Agents (Builder)",
    path: "/api/agents",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p !== "demo") return pass(`${res.body.length} agents`);
      // demo: require a real agent that isn't dead — catches a broken deploy,
      // where the agent lands FAILED instead of READY/CREATING.
      const live = res.body.filter((a) => {
        const s = (a as { status?: string }).status;
        return s === "READY" || s === "CREATING";
      });
      if (live.length >= 1) return pass(`${live.length}/${res.body.length} agents live (READY/CREATING)`);
      return fail(res.body.length ? "demo profile: agents exist but all FAILED (deploy is broken)" : "demo profile: no agent seeded (Catalog section empty)");
    }),
  },
  { screen: "Costs", path: "/api/dashboard/costs", check: (_p, res) => on200(res, () => pass("renders")) },
  { screen: "Admin (audit)", path: "/api/admin/audit/summary", check: (_p, res) => on200(res, () => pass("renders")) },
  { screen: "Settings", path: "/api/settings/site", check: (_p, res) => on200(res, () => pass("renders")) },
  { screen: "Registry", path: "/api/registry/records", check: (_p, res) => on200(res, () => pass("renders")) },
];
