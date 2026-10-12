/**
 * Per-screen validation runner (loomster#103 follow-up).
 *
 * Fetches every screen's data endpoint against a live Loom and applies the
 * per-profile checks in `./checks.ts`. Prints a screen-by-screen table and
 * exits non-zero if any screen fails — so "validated" means every screen loads
 * and holds what the active seed profile promises, not a hand spot-check.
 *
 *   npm run validate                                  # demo profile, local-up app
 *   LOOM_SEED_PROFILE=foundation npm run validate     # production floor
 *   LOOM_API_BASE_URL=https://loom.example.com npm run validate
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { NO_TARGET, SCREEN_CHECKS, type FetchResult, type Profile } from "./checks";

const BASE = (process.env.LOOM_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const PROFILE = (process.env.LOOM_SEED_PROFILE ?? "demo") as Profile;

// Every Loom enforces auth on its data endpoints, the local-up app included
// (real Cognito login against Floci, loomster#58). Pass LOOM_API_TOKEN (a bearer
// JWT: an M2M client-credentials token or a real user token, e.g. from
// scripts/validate/get-user-token.sh). Against the local-up proxy with no token
// set, the runner mints one itself with scripts/local/local-token.sh.
const LOCAL_BASE = "http://localhost:8080";
function localToken(): string | undefined {
  if (BASE !== LOCAL_BASE || !existsSync("dist/local/.env")) return undefined;
  try {
    return execFileSync("bash", ["scripts/local/local-token.sh"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  } catch {
    return undefined;
  }
}
const TOKEN = process.env.LOOM_API_TOKEN || localToken();
const AUTH_HEADERS: Record<string, string> = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

async function fetchScreen(path: string): Promise<FetchResult> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json", ...AUTH_HEADERS } });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: undefined };
  }
}

async function main(): Promise<void> {
  console.log(`Validating Loom screens at ${BASE} (seed profile: ${PROFILE})\n`);
  const rows: Array<{ screen: string; ok: boolean; detail: string }> = [];
  const fetched = new Map<string, FetchResult>();
  const seen = (path: string) => fetched.get(path);
  for (const c of SCREEN_CHECKS) {
    const path = typeof c.path === "string" ? c.path : c.path(seen);
    let res: FetchResult = { status: NO_TARGET, body: undefined };
    if (path !== undefined) {
      res = await fetchScreen(path);
      fetched.set(path, res);
    }
    const r = c.check(PROFILE, res, seen);
    rows.push({ screen: c.screen, ok: r.ok, detail: r.detail });
  }

  const width = Math.max(...rows.map((r) => r.screen.length));
  for (const r of rows) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.screen.padEnd(width)}  ${r.detail}`);
  }

  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} screens passed.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((r) => r.screen).join(", ")}`);
    process.exit(1);
  }
}

void main();
