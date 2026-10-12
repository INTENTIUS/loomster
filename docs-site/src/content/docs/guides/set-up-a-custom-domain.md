---
title: Set up a custom domain
description: Serve a production-tier Loom on your own domain over HTTPS by referencing an existing Route53 zone and certificate, letting loomster create them, or dropping the domain.
prompt: |
  Read https://intentius.io/loomster/guides/set-up-a-custom-domain/ and work out which of its three paths fits the person's DNS: list their Route53 hosted zones and ACM certificates with read-only calls.
  Report the variables to set for that path. Run `npm run dns-setup` only if the person asked for it in this session.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

The ALB serving HTTPS on `LOOM_DOMAIN_NAME`, with an alias record in a hosted
zone and a certificate on the listener. Light serves on the ALB's own DNS name
and needs none of this; the production [tiers](/loomster/concepts/tiers-and-instances/)
require `LOOM_DOMAIN_NAME`.

## Prerequisites

A domain, and either a Route53 hosted zone for it plus a DNS-validated ACM
certificate in the deploy region, or access to the parent domain's DNS provider.

## Steps

Pick one path; each is a mode of the route53 and acm
[seams](/loomster/concepts/glossary/#seam).

### Reference an existing zone and certificate

The common case: you own the parent domain in Route53 and want records added to
it, not a new zone.

```
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_HOSTED_ZONE_ID=<hosted zone id>
export LOOM_CERTIFICATE_ARN=<ACM certificate ARN, already validated>
```

loomster creates no zone and no certificate. It adds the alias record to your
zone, attaches your certificate to the HTTPS listener, and passes both ids
through as `oHostedZoneId` and `oCertificateArn`.

### Let loomster create them

Set only `LOOM_DOMAIN_NAME`. The stack creates a hosted zone and a certificate
validated through it. The certificate validates only once the parent delegates
to the new zone, so run the DNS [Op](/loomster/concepts/glossary/#op) first:

```
LOOM_DOMAIN_NAME=loom.example.com npm run dns-setup
```

It creates the zone (adopting one that exists), prints `LOOM_HOSTED_ZONE_ID` and
four NS records, and polls public DNS. At the parent's provider add one record:

| Field | Value |
|---|---|
| Name | `loom.example.com` (or `loom`, depending on the provider) |
| Type | `NS` |
| Value | the four `ns-*.awsdns-*` servers it printed, one per line |

The Op finishes when `dig +short NS loom.example.com` returns them. It polls
instead of asking for an approval because the delegation is something it can
check. Export the printed `LOOM_HOSTED_ZONE_ID` before deploying.

### Drop the custom domain

```
export LOOM_ROUTE53=omit
export LOOM_ACM=omit
```

The ALB serves HTTP on its own DNS name, as on light. Useful for an internal or
throwaway production-tier deploy.

How the modes resolve, in `src/shared-foundation/params.ts`: a zone id or
certificate ARN wins; otherwise `LOOM_ROUTE53` and `LOOM_ACM` of `omit` or
`provision` apply; unset leaves the tier's default, `provision` on the production
tiers.

## Next

[Deploy to production on AWS](/loomster/guides/deploy-to-production/).
