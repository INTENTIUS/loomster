---
title: Recover from an IdP lockout
description: Get back into a Loom whose login page an identity provider took over, by calling Loom's API with a Cognito token and deleting or deactivating the provider.
prompt: |
  Read https://intentius.io/loomster/guides/recover-from-an-idp-lockout/ and, for the deployment the person names, mint a Cognito token as the page shows, list the identity providers, and show the person which one is active.
  Delete or deactivate it only if the person confirms which one in this session, then delete any throwaway user and client you created.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

Registering an identity provider under Security > Identity providers switches
Loom's login page to that provider. If nothing real stands behind it, nobody can
sign in through the page. This is why `loom-seed` never registers one.

The API still accepts Cognito tokens: Loom tries the active provider first and
falls back to the deployment's Cognito pool when that validation fails. So a
token minted against the pool gets you back in.

## Result

The provider deleted or set inactive, and the login page back on Cognito.

## Prerequisites

The deployment's `LOOM_*` variables and AWS credentials that can manage its
Cognito pool.

## Steps

1. Mint a Cognito token. On the production [tiers](/loomster/concepts/tiers-and-instances/):

   ```
   export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
   ```

   Light has no end-user client; add a temporary one first
   ([Deploy the light tier to AWS](/loomster/tutorial/light-on-aws/#3-get-a-token)).
   The token's user is in `g-admins-super`, which provider management needs.

2. Find the provider:

   ```
   BASE=https://loom.example.com
   curl -s -H "Authorization: Bearer $LOOM_API_TOKEN" $BASE/api/settings/identity-providers | jq '.[] | {id, name, provider_type, status}'
   ```

3. Delete it, or set it inactive to keep its settings:

   ```
   curl -s -X DELETE -H "Authorization: Bearer $LOOM_API_TOKEN" $BASE/api/settings/identity-providers/<id>
   # or keep it, inactive:
   curl -s -X PUT -H "Authorization: Bearer $LOOM_API_TOKEN" -H 'Content-Type: application/json' \
     -d '{"status":"inactive"}' $BASE/api/settings/identity-providers/<id>
   ```

   Both need the `security:write` scope, which `g-admins-super` has. With no
   active provider the login page returns to Cognito.

4. Remove the throwaway user (`bash scripts/validate/get-user-token.sh --delete`)
   and any temporary client.

On the local stack the same steps work against `http://localhost:8080` with a
token from `scripts/local/local-token.sh`.

## Next

[Security](/loomster/reference/security/#visibility-in-loom) on how Loom
derives scopes from groups.
