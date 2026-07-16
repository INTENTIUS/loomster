import { describe, test, expect } from "vitest";
import { ensureZoneScript, awaitDelegationScript } from "./dns-setup";

const domain = "loom.intentius.io";

describe("ensureZoneScript", () => {
  test("looks up the zone by name first and only creates when absent (idempotent)", () => {
    const s = ensureZoneScript(domain);
    expect(s).toContain("list-hosted-zones-by-name");
    expect(s).toContain('if [ -z "$ZID" ] || [ "$ZID" = "None" ]');
    expect(s).toContain("create-hosted-zone");
    expect(s).toContain(`--dns-name "$DOMAIN"`);
  });

  test("prints the LOOM_HOSTED_ZONE_ID and the NS records to delegate", () => {
    const s = ensureZoneScript(domain);
    expect(s).toContain("LOOM_HOSTED_ZONE_ID=");
    expect(s).toContain("DelegationSet.NameServers");
    expect(s).toContain(`DOMAIN="${domain}"`);
  });
});

describe("awaitDelegationScript", () => {
  test("polls public DNS for the NS delegation and exits 0 when live", () => {
    const s = awaitDelegationScript(domain);
    expect(s).toContain(`dig +short NS "$DOMAIN" @8.8.8.8`);
    expect(s).toContain("exit 0");
  });

  test("bounds the wait and fails with guidance on timeout", () => {
    const s = awaitDelegationScript(domain, 3, 5);
    expect(s).toContain("seq 1 3");
    expect(s).toContain("sleep 5");
    expect(s).toContain("timeout");
    expect(s).toContain("exit 1");
  });
});
