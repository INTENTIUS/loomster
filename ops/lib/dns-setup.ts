/**
 * DNS-setup scripts for a custom-domain production deploy (#125). Pure,
 * unit-testable AWS CLI script builders, same shape as `./backup.ts` / `./restore.ts`.
 *
 * A production deploy provisions an ACM certificate that is DNS-validated into a
 * Route53 zone for the app's domain. For validation to succeed the zone must be
 * delegated from the parent domain — an out-of-band step at whatever DNS provider
 * is authoritative for the parent (e.g. adding an `NS` record for
 * `loom.intentius.io` at the `intentius.io` provider). If the zone isn't delegated,
 * the cert never validates and the CloudFormation apply hangs.
 *
 * This models that as a human-in-the-loop step that still runs on the LOCAL
 * executor: `ensureZoneScript` creates (idempotently) the hosted zone and prints
 * the NS records to add, and `awaitDelegationScript` polls public DNS until the
 * delegation resolves. The human action (adding the records at the provider)
 * happens between the two; the Op waits for its observable effect rather than a
 * durable approval signal — a real chant `gate()` needs `--temporal` (the local
 * executor rejects gates), and here the completion condition is observable, so a
 * poll is both local-runnable and safer than a blind approve.
 */

/**
 * Idempotently ensure a Route53 public hosted zone for `domain` exists, then print
 * the NS records to delegate at the parent's DNS provider. Re-running adopts the
 * existing zone (looks it up by name first) instead of creating a duplicate.
 * `callerReference` must be unique per real creation — pass a run-stamped value
 * (the Op stamps it from the environment; `date` is used at execution time, not here).
 */
export function ensureZoneScript(domain: string): string {
  return [
    "set -euo pipefail",
    `DOMAIN="${domain}"`,
    `ZID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text)`,
    `if [ -z "$ZID" ] || [ "$ZID" = "None" ]; then`,
    `  echo "dns-setup: creating hosted zone $DOMAIN"`,
    `  ZID=$(aws route53 create-hosted-zone --name "$DOMAIN" --caller-reference "loom-dns-$(date -u +%Y%m%d%H%M%S)" --hosted-zone-config Comment="loomster custom-domain (dns-setup Op)" --query HostedZone.Id --output text)`,
    `else`,
    `  echo "dns-setup: adopting existing hosted zone $ZID for $DOMAIN"`,
    `fi`,
    `echo "LOOM_HOSTED_ZONE_ID=$(basename "$ZID")"`,
    `echo "dns-setup: add these NS records for $DOMAIN at your DNS provider (delegate from the parent):"`,
    `aws route53 get-hosted-zone --id "$ZID" --query "DelegationSet.NameServers" --output text | tr '\\t' '\\n' | sed 's/^/    /'`,
  ].join("\n");
}

/**
 * Poll public DNS until `domain` resolves NS records (the delegation is live),
 * then exit 0. Fails after `attempts` tries (default 60 × 30s = 30 min) with the
 * records re-printed, so a re-run resumes against the same (idempotent) zone.
 * The human adds the NS records at their provider while this waits.
 */
export function awaitDelegationScript(domain: string, attempts = 60, intervalSecs = 30): string {
  return [
    "set -euo pipefail",
    `DOMAIN="${domain}"`,
    `for i in $(seq 1 ${attempts}); do`,
    `  LIVE=$(dig +short NS "$DOMAIN" @8.8.8.8 | head -1 | sed 's/\\.$//')`,
    `  if [ -n "$LIVE" ]; then echo "dns-setup: delegation live for $DOMAIN ($LIVE) — ACM validation will resolve"; exit 0; fi`,
    `  echo "dns-setup: waiting for NS delegation of $DOMAIN ... ($i/${attempts})"`,
    `  sleep ${intervalSecs}`,
    `done`,
    `echo "dns-setup: timeout — $DOMAIN still has no public NS delegation. Add the NS records shown above at your DNS provider, then re-run." >&2`,
    `exit 1`,
  ].join("\n");
}
