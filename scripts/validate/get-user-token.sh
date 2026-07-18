#!/usr/bin/env bash
set -euo pipefail

# Mint a real Cognito USER access token for authenticated screen validation against
# a live deployment (loomster#147). Loom derives a user's scopes from their
# `cognito:groups` claim (backend/app/dependencies/auth.py: `derive_scopes(groups)`),
# and an admin needs `t-admin` + a single `g-admins-*` group. loomster seeds no
# users or groups, so this creates a throwaway admin end-to-end.
#
# The full (production) tier enforces MFA on the pool (hardening rule WAW052,
# `MfaConfiguration: ON`, software-token TOTP), so a plain ADMIN_USER_PASSWORD_AUTH
# returns an `MFA_SETUP` challenge rather than tokens. This script completes that
# dance: associate a software token, compute its TOTP code, verify it, and respond
# to the challenge — so it works on both the MFA-off (light) and MFA-on (full) pools.
#
# Steps:
#   1. delete any stale throwaway user, then recreate it fresh (guarantees MFA_SETUP,
#      never a stale SOFTWARE_TOKEN_MFA whose secret we don't hold),
#   2. ensure the `t-admin` + `g-admins-super` groups exist and add the user to both,
#   3. ADMIN_USER_PASSWORD_AUTH; on MFA_SETUP, associate + TOTP-verify a software
#      token and respond to the challenge,
#   4. print ONLY the access token (which carries `cognito:groups`, so Loom grants
#      the full scope set and every screen authorizes).
#
#   export LOOM_API_TOKEN=$(bash scripts/validate/get-user-token.sh)
#   LOOM_API_BASE_URL=https://loom.intentius.io npm run validate
#   bash scripts/validate/get-user-token.sh --delete   # remove the throwaway user
#
# Stack names are namespaced by project+env+instance (#140). E2E-only — a real
# deployment brings its own users; never leave this user on a real tenant. Every
# AWS call's stdout is suppressed so the access token is the only thing on stdout.

SF="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}-loom-cognito"
q() { aws cloudformation describe-stacks --stack-name "$SF" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text 2>/dev/null || echo ""; }
# Normally the pool + user client come from the loom-cognito stack outputs. The
# LOOM_E2E_POOL_ID/LOOM_E2E_CLIENT_ID overrides let the MFA flow be exercised
# against a standalone pool with no stack (used to validate this script itself).
POOL="${LOOM_E2E_POOL_ID:-$(q oCognitoUserPoolId)}"
CLIENT="${LOOM_E2E_CLIENT_ID:-$(q oUserClientId)}"
USERNAME="${LOOM_E2E_USER:-e2e-validator}"
PASSWORD="${LOOM_E2E_PASSWORD:-E2e-Validate-9x7q2w!}"
[ -n "$POOL" ] && [ "$POOL" != "None" ] || { echo "get-user-token: no $SF pool output (deploy loom-cognito first)" >&2; exit 1; }
[ -n "$CLIENT" ] && [ "$CLIENT" != "None" ] || { echo "get-user-token: no oUserClientId output on $SF" >&2; exit 1; }

if [ "${1:-}" = "--delete" ]; then
  aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$USERNAME" >/dev/null 2>&1 || true
  echo "get-user-token: deleted throwaway user $USERNAME" >&2
  exit 0
fi

# A fresh user every run — so the first sign-in is always MFA_SETUP, never a
# SOFTWARE_TOKEN_MFA challenge for a device secret we didn't keep.
aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$USERNAME" >/dev/null 2>&1 || true
aws cognito-idp create-group --user-pool-id "$POOL" --group-name t-admin >/dev/null 2>&1 || true
aws cognito-idp create-group --user-pool-id "$POOL" --group-name g-admins-super >/dev/null 2>&1 || true
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$USERNAME" --message-action SUPPRESS >/dev/null 2>&1 || true
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$USERNAME" --password "$PASSWORD" --permanent >/dev/null
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$USERNAME" --group-name t-admin >/dev/null
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$USERNAME" --group-name g-admins-super >/dev/null

# Compute a 6-digit TOTP from a base32 secret (RFC 6238, 30s window) — no oathtool dep.
totp() { python3 - "$1" <<'PY'
import sys, base64, hmac, hashlib, struct, time
s = sys.argv[1].upper()
key = base64.b32decode(s + "=" * ((8 - len(s) % 8) % 8))
msg = struct.pack(">Q", int(time.time()) // 30)
h = hmac.new(key, msg, hashlib.sha1).digest()
o = h[-1] & 0xF
print("%06d" % ((struct.unpack(">I", h[o:o+4])[0] & 0x7FFFFFFF) % 1000000))
PY
}

json() { aws "$@" --output json 2>/tmp/get-user-token.awserr || { echo "get-user-token: aws $2 failed:" >&2; cat /tmp/get-user-token.awserr >&2; return 1; }; }

RESP=$(json cognito-idp admin-initiate-auth --user-pool-id "$POOL" --client-id "$CLIENT" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD")
TOKEN=$(printf '%s' "$RESP" | jq -r '.AuthenticationResult.AccessToken // empty')

if [ -z "$TOKEN" ]; then
  CHALLENGE=$(printf '%s' "$RESP" | jq -r '.ChallengeName // empty')
  SESSION=$(printf '%s' "$RESP" | jq -r '.Session // empty')
  if [ "$CHALLENGE" != "MFA_SETUP" ]; then
    echo "get-user-token: unexpected challenge '$CHALLENGE' (want MFA_SETUP); no token" >&2; exit 1
  fi
  # Set up software-token MFA on the fly, then answer the challenge.
  ASSOC=$(json cognito-idp associate-software-token --session "$SESSION")
  SECRET=$(printf '%s' "$ASSOC" | jq -r '.SecretCode')
  SESSION=$(printf '%s' "$ASSOC" | jq -r '.Session')
  VER=$(json cognito-idp verify-software-token --session "$SESSION" --user-code "$(totp "$SECRET")")
  [ "$(printf '%s' "$VER" | jq -r '.Status')" = "SUCCESS" ] || { echo "get-user-token: TOTP verify failed" >&2; exit 1; }
  SESSION=$(printf '%s' "$VER" | jq -r '.Session')
  RESP=$(json cognito-idp admin-respond-to-auth-challenge --user-pool-id "$POOL" --client-id "$CLIENT" \
    --challenge-name MFA_SETUP --session "$SESSION" --challenge-responses "USERNAME=$USERNAME")
  TOKEN=$(printf '%s' "$RESP" | jq -r '.AuthenticationResult.AccessToken // empty')
fi

[ -n "$TOKEN" ] && [ "$TOKEN" != "None" ] || { echo "get-user-token: auth returned no access token" >&2; exit 1; }
echo "$TOKEN"
