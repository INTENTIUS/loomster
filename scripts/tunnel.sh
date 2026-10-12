#!/usr/bin/env bash
# Port-forward to this deployment's database through the SSM tunnel host
# (loomster#37): the chant version of Loom's `make tunnel`
# (backend/makefile, v1.9.0). Deploy the host first with `just tunnel-host`.
#
#   just tunnel            # localhost:5432 -> the RDS Proxy (or RDS on light)
#   just tunnel 15432      # another local port
#
# Resolves the instance from the tunnel host stack's `oInstanceId` and the
# endpoint/port from loom-db's `oConnectEndpoint`/`oRdsPort`, the RDS Proxy
# on production tiers (as Loom's tunnel targets `O_RDS_PROXY_ENDPOINT`).
# Stacks are named {LOOM_PROJECT}-{LOOM_ENV}-{LOOM_INSTANCE}-<component>.
# Runs until Ctrl-C. Needs the AWS CLI's Session Manager plugin.
set -euo pipefail

PREFIX="${LOOM_PROJECT:-loom}-${LOOM_ENV:-dev}-${LOOM_INSTANCE:-a}"
LOCAL_PORT="${1:-${LOOM_TUNNEL_LOCAL_PORT:-5432}}"

out() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null | grep -v '^None$' || true; }

command -v session-manager-plugin >/dev/null 2>&1 || {
  echo "tunnel: install the AWS CLI Session Manager plugin first (https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)" >&2
  exit 1
}

INSTANCE_ID="$(out "$PREFIX-tunnel-host" oInstanceId)"
[ -n "$INSTANCE_ID" ] || { echo "tunnel: no $PREFIX-tunnel-host stack; deploy it with: just tunnel-host" >&2; exit 1; }
HOST="$(out "$PREFIX-loom-db" oConnectEndpoint)"
[ -n "$HOST" ] || { echo "tunnel: $PREFIX-loom-db has no oConnectEndpoint" >&2; exit 1; }
PORT="$(out "$PREFIX-loom-db" oRdsPort)"
PORT="${PORT:-5432}"
SECRET="$(out "$PREFIX-loom-db" oRdsCredentialsSecretArn)"

echo "tunnel: localhost:$LOCAL_PORT -> $HOST:$PORT through $INSTANCE_ID (Ctrl-C to stop)"
[ -z "$SECRET" ] || echo "tunnel: credentials: aws secretsmanager get-secret-value --secret-id $SECRET --query SecretString --output text"
exec aws ssm start-session \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$HOST\"],\"portNumber\":[\"$PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
