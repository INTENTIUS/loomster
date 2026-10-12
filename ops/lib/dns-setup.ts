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
 * This models that as a human-in-the-loop step inside one run:
 * `ensureZoneScript` creates (idempotently) the hosted zone and prints
 * the NS records to add, and `awaitDelegationScript` polls public DNS until the
 * delegation resolves. The human action (adding the records at the provider)
 * happens between the two; the Op waits for its observable effect rather than a
 * chant `gate()`, because the completion condition is observable and a poll is
 * safer than a blind approve.
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
    `  echo "dns-setup: creating hosted zone $DOMAIN" >&2`,
    `  ZID=$(aws route53 create-hosted-zone --name "$DOMAIN" --caller-reference "loom-dns-$(date -u +%Y%m%d%H%M%S)" --hosted-zone-config Comment="loomster custom-domain (dns-setup Op)" --query HostedZone.Id --output text)`,
    `else`,
    `  echo "dns-setup: adopting existing hosted zone $ZID for $DOMAIN" >&2`,
    `fi`,
    `NS="$(aws route53 get-hosted-zone --id "$ZID" --query "DelegationSet.NameServers" --output text | tr '\\t' ' ')"`,
    `echo "LOOM_HOSTED_ZONE_ID=$(basename "$ZID")" >&2`,
    `echo "dns-setup: add these NS records for $DOMAIN at your DNS provider (delegate from the parent):" >&2`,
    `for n in $NS; do echo "    $n" >&2; done`,
    // stdout is the step's output (#26): only the zone's name servers, which
    // AwaitDelegation waits for. Everything for the person goes to stderr.
    `echo "$NS"`,
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
    // The zone's own name servers, from EnsureZone's output (LOOM_ZONE_NAME_SERVERS,
    // #26). With them, a delegation still pointing at another zone (an old one,
    // or another account's) keeps waiting instead of passing; without them, any
    // public NS answer counts, as before.
    `norm() { tr ' ' '\\n' | sed 's/\\.$//' | tr 'A-Z' 'a-z' | { grep -v '^$' || true; } | sort -u | tr '\\n' ' '; }`,
    `WANT="$(printf '%s' "\${LOOM_ZONE_NAME_SERVERS:-}" | norm)"`,
    `for i in $(seq 1 ${attempts}); do`,
    `  LIVE="$(dig +short NS "$DOMAIN" @8.8.8.8 | norm)"`,
    `  if [ -n "$LIVE" ] && { [ -z "$WANT" ] || [ "$LIVE" = "$WANT" ]; }; then echo "dns-setup: delegation live for $DOMAIN ($LIVE) — ACM validation will resolve"; exit 0; fi`,
    `  if [ -n "$LIVE" ]; then echo "dns-setup: $DOMAIN delegates to $LIVE, not this zone's $WANT ... ($i/${attempts})"; else echo "dns-setup: waiting for NS delegation of $DOMAIN ... ($i/${attempts})"; fi`,
    `  sleep ${intervalSecs}`,
    `done`,
    `echo "dns-setup: timeout — $DOMAIN isn't delegated to this zone's name servers yet. Add the NS records shown above at your DNS provider, then re-run." >&2`,
    `exit 1`,
  ].join("\n");
}
