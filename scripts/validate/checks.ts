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
 * populate assert the seeded shape per profile. POST-only actions (a model
 * invoke test, the models.json refresh) are checked as mounted routes and never
 * triggered. Per-agent and per-skill tabs build their path from an earlier
 * check's data, so checks run in order. Not covered yet: the agent kill switch,
 * until it lands in a Loom release (loomster#16).
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

/** What an earlier check fetched, by path (undefined if nothing fetched it). */
export type Seen = (path: string) => FetchResult | undefined;

export interface ScreenCheck {
  screen: string;
  /**
   * The endpoint, or a function building it from what earlier checks fetched
   * (the demo agent's id, the demo skill's record id). The function returns
   * undefined when there is nothing to build it from; the check then gets a
   * NO_TARGET result.
   */
  path: string | ((seen: Seen) => string | undefined);
  check: (profile: Profile, res: FetchResult, seen: Seen) => CheckResult;
}

/** The status a check gets when its path could not be built (no agent, no skill record). */
export const NO_TARGET = -1;

const pass = (detail: string): CheckResult => ({ ok: true, detail });
const fail = (detail: string): CheckResult => ({ ok: false, detail });
const isArray = (b: unknown): b is unknown[] => Array.isArray(b);

/** Gate every check on a 200 first, so a 404/500 fails loudly rather than as a shape mismatch. */
function on200(res: FetchResult, then: () => CheckResult): CheckResult {
  return res.status === 200 ? then() : fail(res.status === 0 ? "unreachable" : `HTTP ${res.status}`);
}

/**
 * A POST-only action the validator must not trigger (a model invoke, a
 * models.json rewrite): a GET on its path answers 405 when the route is
 * mounted and 404 when it is not, before auth or any side effect.
 */
function mountedPostOnly(res: FetchResult): CheckResult {
  if (res.status === 405) return pass("route mounted (POST-only; not triggered)");
  return fail(res.status === 0 ? "unreachable" : `HTTP ${res.status} (expected 405 from a GET on a POST-only route)`);
}

/** A check whose path came from another screen: on demo the seed guarantees the target, elsewhere its absence is fine. */
function onTarget(p: Profile, res: FetchResult, missing: string, then: () => CheckResult): CheckResult {
  if (res.status !== NO_TARGET) return on200(res, then);
  return p === "demo" ? fail(`demo profile: ${missing}`) : pass(`skipped: ${missing}`);
}

const DEMO_AGENT = "loomster_demo_agent";
const DEMO_SKILL = "loomster-demo-skill";
const SKILLS_PATH = "/api/registry/records?descriptor_type=SKILL";

/** The agent the per-agent tabs open: the seeded demo agent, else the first one listed. */
export function agentIdFrom(seen: Seen): number | undefined {
  const body = seen("/api/agents")?.body;
  if (!isArray(body) || body.length === 0) return undefined;
  const agents = body as Array<{ id?: number; name?: string }>;
  return (agents.find((a) => a.name === DEMO_AGENT) ?? agents[0]).id;
}

/** The SKILL record whose dependents to check: the seeded demo skill, else the first one listed. */
export function skillRecordIdFrom(seen: Seen): string | undefined {
  const body = seen(SKILLS_PATH)?.body;
  if (!isArray(body) || body.length === 0) return undefined;
  const records = body as Array<{ record_id?: string; name?: string }>;
  return (records.find((r) => r.name === DEMO_SKILL) ?? records[0]).record_id;
}

const registryEnabled = (seen: Seen): boolean => (seen("/api/settings/registry")?.body as { enabled?: boolean } | undefined)?.enabled === true;

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
    // The Security screen also has Identity Providers — deliberately left empty:
    // seeding one switches Loom's login to that provider and locks a local/demo
    // deploy with no real IdP behind it. So this only checks the tab renders.
    screen: "Security — identity providers",
    path: "/api/settings/identity-providers",
    check: (_p, res) => on200(res, () => (isArray(res.body) ? pass(`${res.body.length} identity providers`) : fail("not an array"))),
  },
  {
    screen: "Security — approval policies",
    path: "/api/settings/approval-policies",
    check: (p, res) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p === "demo") return res.body.length >= 1 ? pass(`${res.body.length} approval policies`) : fail("demo profile: no approval policy seeded");
      return pass(`${res.body.length} approval policies`);
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
  {
    // Costs is a runtime dashboard aggregated from invocation records — it stays
    // at zero until agents run. On demo, loom-seed invokes the demo agent a few
    // times, so a zero here means those runtime dashboards never got populated.
    screen: "Costs",
    path: "/api/dashboard/costs",
    check: (p, res) => on200(res, () => {
      if (p !== "demo") return pass("renders");
      const n = (res.body as { total_invocations?: number } | null)?.total_invocations ?? 0;
      return n >= 1 ? pass(`${n} invocations recorded`) : fail("demo profile: no invocations recorded (runtime dashboards empty)");
    }),
  },
  { screen: "Admin (audit)", path: "/api/admin/audit/summary", check: (_p, res) => on200(res, () => pass("renders")) },
  { screen: "Settings", path: "/api/settings/site", check: (_p, res) => on200(res, () => pass("renders")) },
  { screen: "Registry", path: "/api/registry/records", check: (_p, res) => on200(res, () => pass("renders")) },
  // ── Added in Loom v1.7 to v1.9 (loomster#15) ──
  {
    // The approval-decision log behind Security > Approval Policies. Decisions
    // are runtime-only (an agent has to hit a policy), so 200 is the bar.
    screen: "Security — approval logs",
    path: "/api/settings/approvals/logs",
    check: (_p, res) => on200(res, () => (isArray(res.body) ? pass(`${res.body.length} approval decisions`) : fail("not an array"))),
  },
  {
    // The model list the Settings screen shows; its Refresh button
    // (POST /api/settings/models/refresh) rewrites it and is checked below
    // without being pressed.
    screen: "Settings — models",
    path: "/api/settings/models",
    check: (_p, res) => on200(res, () => pass("renders")),
  },
  { screen: "Settings — models refresh", path: "/api/settings/models/refresh", check: (_p, res) => mountedPostOnly(res) },
  { screen: "Agents — model invoke-test", path: "/api/agents/models/invoke-test", check: (_p, res) => mountedPostOnly(res) },
  {
    // The registry's own settings; the Skills checks below read whether one is configured.
    screen: "Settings — registry",
    path: "/api/settings/registry",
    check: (_p, res) => on200(res, () => {
      const b = res.body as { enabled?: boolean; registry_id?: string } | undefined;
      return b?.enabled ? pass(`registry ${b.registry_id}`) : pass("no registry configured (Registry and Skills stay empty)");
    }),
  },
  {
    // The Skills page. The registry is optional (reference-existing), so the
    // demo skill is required only when one is configured.
    screen: "Skills",
    path: SKILLS_PATH,
    check: (p, res, seen) => on200(res, () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p !== "demo" || !registryEnabled(seen)) return pass(`${res.body.length} skills`);
      const demo = (res.body as Array<{ name?: string; status?: string }>).find((r) => r.name === DEMO_SKILL);
      if (!demo) return fail(`demo profile: registry configured but no ${DEMO_SKILL} record seeded`);
      return demo.status === "APPROVED" ? pass(`${res.body.length} skills, ${DEMO_SKILL} APPROVED`) : fail(`demo profile: ${DEMO_SKILL} is ${demo.status ?? "without a status"}, not APPROVED`);
    }),
  },
  {
    screen: "Skills — dependents",
    path: (seen) => {
      const id = skillRecordIdFrom(seen);
      return id ? `/api/registry/records/${encodeURIComponent(id)}/dependents` : undefined;
    },
    check: (p, res, seen) => {
      if (res.status === NO_TARGET) return pass("no skill record to open");
      return on200(res, () => {
        const deps = (res.body as { dependents?: Array<{ agent_name?: string }> } | undefined)?.dependents;
        if (!isArray(deps)) return fail("no dependents array");
        if (p !== "demo" || !registryEnabled(seen)) return pass(`${deps.length} dependent agents`);
        return deps.some((d) => d.agent_name === DEMO_AGENT) ? pass(`${deps.length} dependent agents, ${DEMO_AGENT} among them`) : fail(`demo profile: ${DEMO_SKILL} is not attached to ${DEMO_AGENT}`);
      });
    },
  },
  {
    // Agent detail > Evaluations: online configs and batch runs, read from
    // AgentCore and CloudWatch. Runtime-only, so 200 is the bar.
    screen: "Agents — evaluations",
    path: (seen) => {
      const id = agentIdFrom(seen);
      return id === undefined ? undefined : `/api/agents/${id}/evaluations`;
    },
    check: (p, res) => onTarget(p, res, "no agent to open", () => pass("renders")),
  },
  {
    // The evaluator picker on the same tab (AgentCore's ListEvaluators).
    screen: "Agents — evaluators",
    path: (seen) => {
      const id = agentIdFrom(seen);
      return id === undefined ? undefined : `/api/agents/${id}/evaluations/evaluators`;
    },
    check: (p, res) => onTarget(p, res, "no agent to open", () => (isArray(res.body) ? pass(`${res.body.length} evaluators`) : fail("not an array"))),
  },
  {
    // Saved test cases. loom-seed adds one on demo and runs it once; the run's
    // score is runtime (it needs the agent's spans), so only that it ran is checked.
    screen: "Agents — evaluation test cases",
    path: (seen) => {
      const id = agentIdFrom(seen);
      return id === undefined ? undefined : `/api/agents/${id}/evaluations/test-cases`;
    },
    check: (p, res) => onTarget(p, res, "no agent to open", () => {
      if (!isArray(res.body)) return fail("not an array");
      if (p !== "demo") return pass(`${res.body.length} test cases`);
      if (res.body.length === 0) return fail("demo profile: no evaluation test case seeded");
      const ran = (res.body as Array<{ last_run_at?: string | null }>).filter((t) => t.last_run_at).length;
      return ran >= 1 ? pass(`${res.body.length} test cases, ${ran} run`) : fail("demo profile: the seeded test case was never run");
    }),
  },
];
