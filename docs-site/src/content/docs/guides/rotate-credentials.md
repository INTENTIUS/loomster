---
title: Rotate credentials
description: Rotate the Cognito machine-to-machine client, the RDS credential and the ALB's certificate on a production tier with the gated rotation Op, switching consumers over before the old credentials are removed.
prompt: |
  Read https://intentius.io/loomster/guides/rotate-credentials/ and, for the production deployment the person names, run the rotation Op up to its gate.
  Report the new Cognito client id, where its secret was written, and what the person must switch over before approving. Do not approve.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

## Result

A new Cognito machine-to-machine client with consumers switched to it and the
old one deleted, a new database credential, and, with a custom domain, a new
certificate on the ALB's listener.

## Prerequisites

- A `production` or `production-ha` deployment. Light has no rotation Op: it has
  no RDS Proxy, no rotation function and no custom domain.
- Its `LOOM_*` variables, including `LOOM_DOMAIN_NAME` when it has a custom
  domain, and AWS credentials.

## Steps

1. Run the Op for the [tier](/loomster/concepts/tiers-and-instances/):

   ```
   chant run loom-rotate-production        # or loom-rotate-production-ha
   ```

   It runs, in order:

   - PrepareCognitoRotation: Cognito can't rotate a client secret in place, so
     the Op creates a replacement client with the same flows and scopes and
     writes `{clientId, clientSecret}` to the Secrets Manager secret
     `<project>-<env>-<instance>-loom-cognito-m2m-client-rotated`.
   - RotateRdsCredential: on production-ha it triggers the secret's own rotation;
     on production, which has no rotation function, it sets a new password on
     the instance and rewrites the credentials secret and the connection-URL
     secret (against the RDS Proxy). In-flight connections can drop.
   - RequestCertificate, with a custom domain: requests and validates a new
     certificate.
   - Approve: stops with exit 3.

2. Switch every consumer of the machine-to-machine client to the new id and
   secret from that Secrets Manager secret.

3. Approve and finish:

   ```
   chant approve loom-rotate-production approve-loom-rotate-production
   chant run loom-rotate-production
   ```

   CompleteRotation deletes the old client, which invalidates its secret for
   anyone still on it, and with a custom domain moves the listener to the new
   certificate. A wrong certificate breaks TLS for every client, which is why
   both wait for the gate ([Gated Ops](/loomster/concepts/gated-ops/)).

## Next

[Ops](/loomster/reference/ops/) for the rest of the lifecycle.
