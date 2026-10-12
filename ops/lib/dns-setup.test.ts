import { describe, test, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { awaitDelegationScript, ensureZoneScript } from "./dns-setup";

// Runs a dns-setup script against stub `aws` (one existing zone) and `dig`
// (answers `digAnswer`, one name server per line).
function run(script: string, opts: { digAnswer?: string; env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dns-setup-stub-"));
  writeFileSync(
    join(dir, "aws"),
    `#!/usr/bin/env bash
case "$2" in
  list-hosted-zones-by-name) echo "/hostedzone/Z123" ;;
  get-hosted-zone) printf 'ns-1.awsdns-01.com\\tns-2.awsdns-02.net\\n' ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, "dig"), `#!/usr/bin/env bash\nprintf '%s' "${opts.digAnswer ?? ""}"\n`, { mode: 0o755 });
  try {
    const r = spawnSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...opts.env },
      encoding: "utf-8",
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loom-dns-setup scripts (#26: the zone's name servers flow from EnsureZone to AwaitDelegation)", () => {
  test("both are valid bash", () => {
    execFileSync("bash", ["-n"], { input: ensureZoneScript("loom.example.com") });
    execFileSync("bash", ["-n"], { input: awaitDelegationScript("loom.example.com") });
  });

  test("EnsureZone's stdout is only the zone's name servers; the instructions go to stderr", () => {
    const r = run(ensureZoneScript("loom.example.com"));
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("ns-1.awsdns-01.com ns-2.awsdns-02.net");
    expect(r.stderr).toContain("LOOM_HOSTED_ZONE_ID=Z123");
    expect(r.stderr).toContain("adopting existing hosted zone");
  });

  const zoneNs = "ns-2.awsdns-02.net ns-1.awsdns-01.com";

  test("AwaitDelegation passes when public DNS answers this zone's name servers, in any order or case", () => {
    const r = run(awaitDelegationScript("loom.example.com", 1, 0), {
      digAnswer: "NS-1.awsdns-01.com.\nns-2.awsdns-02.net.\n",
      env: { LOOM_ZONE_NAME_SERVERS: zoneNs },
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("delegation live");
  });

  test("AwaitDelegation keeps waiting on a delegation to another zone", () => {
    const r = run(awaitDelegationScript("loom.example.com", 2, 0), {
      digAnswer: "ns-9.old-zone.example.\n",
      env: { LOOM_ZONE_NAME_SERVERS: zoneNs },
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("not this zone's");
  });

  test("without the zone's name servers, any public NS answer counts, as before", () => {
    expect(run(awaitDelegationScript("loom.example.com", 1, 0), { digAnswer: "ns-9.old-zone.example.\n" }).code).toBe(0);
    expect(run(awaitDelegationScript("loom.example.com", 1, 0), { digAnswer: "" }).code).toBe(1);
  });
});
