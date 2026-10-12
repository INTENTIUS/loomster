---
title: Add the first admin
description: Create the first user in a deployed Loom's Cognito pool, put it in the admin groups, and sign in to the web app.
prompt: |
  Read https://intentius.io/loomster/guides/add-the-first-admin/ and, for the deployment the person names, create the admin user the page shows with the username and email the person gives, add it to t-admin and g-admins-super, and print the address to sign in at.
  Ask the person for the temporary password or have them set it themselves; never print a password into a shared log.
  Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.
---

Every [tier](/loomster/concepts/glossary/#tier) provisions a Cognito user pool
with the end-user client Loom's web app signs in with, and loomster builds that
client's id into the frontend image. loomster creates no users, so a new deployment has nobody who can sign
in until you add one.

Loom decides what a user can do from their Cognito groups, not from anything
in the client. `t-admin` picks the admin view and `g-admins-super` grants every
permission. Every tier provisions both groups, along with `t-user`.

## Result

An admin user who signs in to the deployed web app and sees every screen.

## Prerequisites

A deployed tier, the deployment's `LOOM_*` variables, and AWS credentials that
can manage its Cognito pool. The examples use `LOOM_ENV=dev` and
`LOOM_INSTANCE=a`; stack names follow `<project>-<env>-<instance>-<component>`.

## Steps

1. Look up the pool:

   ```
   POOL=$(aws cloudformation describe-stacks --stack-name loom-dev-a-loom-cognito \
     --query "Stacks[0].Outputs[?OutputKey=='oCognitoUserPoolId'].OutputValue" --output text)
   ```

2. Create the user with a temporary password. The pool's policy wants at least
   12 characters with upper case, lower case and a number.

   ```
   aws cognito-idp admin-create-user --user-pool-id $POOL --username alice \
     --user-attributes Name=email,Value=alice@example.com Name=email_verified,Value=true \
     --temporary-password '<temporary password>' --message-action SUPPRESS
   ```

3. Put the user in the admin groups:

   ```
   aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username alice --group-name t-admin
   aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username alice --group-name g-admins-super
   ```

   For a user who only uses agents, add `t-user` and a `g-users-*` group of
   your own instead (`LOOM_COGNITO_RESOURCE_GROUPS_JSON` provisions more groups).

4. Open the web app and sign in. On light it is served on the load balancer's
   address over HTTP:

   ```
   aws cloudformation describe-stacks --stack-name loom-dev-a-shared-foundation \
     --query "Stacks[0].Outputs[?OutputKey=='oDomainName'].OutputValue" --output text
   ```

   On production and production-ha it is `https://<LOOM_DOMAIN_NAME>`. The
   first sign-in asks for a new password, which replaces the temporary one.

### MFA

Light pools have MFA off. Production pools default to `OPTIONAL` with software
tokens. Loom's web app signs in with a username and password and doesn't
answer an MFA challenge, so a user who registers a software token can no
longer sign in through the page. `LOOM_COGNITO_MFA=ON` requires MFA for every
user, which locks everyone out of the web app; set it only when your users
reach Loom some other way, such as API tokens.

### A shared pool

With `LOOM_COGNITO_MODE=reference-existing`, set `LOOM_COGNITO_USER_CLIENT_ID`
to the shared pool's end-user client, or the frontend is built without one and
its sign-in form can't sign anyone in. The client needs
`ALLOW_USER_PASSWORD_AUTH` and no secret. Users and groups then live in that
pool ([Share a Cognito pool](/loomster/guides/share-a-cognito-pool/)).

## Next

- [Seed and validate a deploy](/loomster/guides/seed-and-validate/) to fill the screens.
- [Security](/loomster/reference/security/) for the access model behind the groups.
