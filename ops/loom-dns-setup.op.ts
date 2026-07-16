/**
 * DNS-setup Op — stand up (and delegate) the Route53 zone a custom-domain
 * production deploy needs, as a local-runnable human-in-the-loop step (#125):
 *
 *   LOOM_DOMAIN_NAME=loom.intentius.io chant run loom-dns-setup
 *
 * Two phases on the LOCAL executor:
 *   1. EnsureZone      — idempotently create the hosted zone, print the NS records
 *                        to add at your DNS provider.
 *   2. AwaitDelegation — poll public DNS until the delegation resolves.
 *
 * The human step (adding the NS records at the parent provider) happens between
 * the phases; phase 2 waits for its observable effect. This is deliberately a
 * poll, not a chant `gate()` — the local executor rejects gates (they need a
 * durable runtime, `--temporal`), and a DNS delegation has an observable
 * completion condition, so polling is both local-runnable and safer than a blind
 * approval that could fire before propagation.
 *
 * Ungated, non-destructive (creates a zone and reads DNS; a zone left behind costs
 * $0.50/mo and is reused on re-run). Once this passes, deploy with the printed
 * LOOM_HOSTED_ZONE_ID and the ACM cert validates during the apply.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";
import { ensureZoneScript, awaitDelegationScript } from "./lib/dns-setup";

const domain = process.env.LOOM_DOMAIN_NAME ?? "loom.example.com";

export default Op({
  name: "loom-dns-setup",
  overview: `Ensure and delegate the Route53 zone for ${domain}: create it (idempotent), print the NS records to add at your DNS provider, then wait for the delegation to resolve so a custom-domain production deploy's ACM cert validates. Local executor, human-in-the-loop.`,
  taskQueue: "loom-lifecycle",
  searchAttributes: { DnsSetup: "true" },
  phases: [
    phase("EnsureZone", [shell(ensureZoneScript(domain), { profile: "fastIdempotent" })]),
    phase("AwaitDelegation", [shell(awaitDelegationScript(domain), { profile: "longInfra" })]),
  ],
});
