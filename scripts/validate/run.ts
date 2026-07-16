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

import { SCREEN_CHECKS, type FetchResult, type Profile } from "./checks";

const BASE = (process.env.LOOM_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const PROFILE = (process.env.LOOM_SEED_PROFILE ?? "demo") as Profile;

async function fetchScreen(path: string): Promise<FetchResult> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
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
  for (const c of SCREEN_CHECKS) {
    const res = await fetchScreen(c.path);
    const r = c.check(PROFILE, res);
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
