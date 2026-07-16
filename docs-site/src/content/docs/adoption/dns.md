---
title: DNS & certificates
description: Reference an existing Route53 zone and ACM certificate, provision new ones, or drop the custom domain — how loomster handles DNS on the production tiers.
---

The production tiers serve on a custom domain over HTTPS, so DNS is part of the
setup. `LOOM_DOMAIN_NAME` is always required on those tiers; the hosted zone and
certificate each have three modes. (Light runs on the ALB's own DNS name and needs
none of this.)

## Reference an existing zone + cert (the common case)

Most teams already own the parent domain in Route53 and want loomster to *add
records* to it, not create a new zone that then needs manual NS delegation. Point
it at your zone and a pre-validated cert:

```
export LOOM_DOMAIN_NAME=loom.example.com
export LOOM_HOSTED_ZONE_ID=<your Route53 hosted zone id>
export LOOM_CERTIFICATE_ARN=<your ACM certificate ARN, already DNS-validated>
```

loomster creates no zone and no certificate. It adds the ALB alias record to your
zone and attaches your cert to the HTTPS listener, and threads the referenced ids
straight through to `oHostedZoneId` / `oCertificateArn` for any downstream consumer.

## Provision a new zone + cert (the default)

Set only `LOOM_DOMAIN_NAME`. loomster creates a Route53 hosted zone and a
DNS-validated ACM certificate. The one manual step this path needs: delegate the
subdomain from the parent zone by adding the new zone's NS records — a provisioned
zone is authoritative for the subdomain only once the parent points at it.

## Drop the custom domain

```
export LOOM_ROUTE53=omit
export LOOM_ACM=omit
```

Serves on the ALB's own DNS name over HTTP, the same as the light tier — useful for
an internal or throwaway production-tier deploy that doesn't need a public domain.

## How the modes resolve

Set at the deployable's [`params.ts`](https://github.com/INTENTIUS/loomster/blob/main/src/shared-foundation/params.ts):
a hosted-zone id or certificate ARN wins (reference-existing); otherwise
`LOOM_ROUTE53` / `LOOM_ACM` of `omit` or `provision` apply; unset leaves the
composite's tier default (`provision` on the production tiers). The
[tutorial's production step](/loomster/getting-started/tutorial/#dns) walks the same
setup inline.
