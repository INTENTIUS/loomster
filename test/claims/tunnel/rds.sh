#!/usr/bin/env bash
# target: aws
# tier: light
# order: 70
# summary: just tunnel-host deploys the SSM tunnel host and just tunnel port-forwards to the private database, where a real Postgres query answers
#
# The docs say the way into a private database is the optional SSM tunnel host
# (`just tunnel-host`, Loom's ec2.yaml, #37) and `just tunnel`, which
# port-forwards a local port through it. On the shared claims deployment
# (claims_aws_ensure loom-db) this:
#   1. runs the loom-tunnel-host Op (with its SSM interface endpoints, since
#      the light tier's subnets have no NAT) and waits for the instance to be
#      online in Systems Manager;
#   2. starts scripts/tunnel.sh (what `just tunnel` runs) on a free local port;
#   3. connects to localhost with the database's master credentials from
#      loom-db's secret and runs SELECT 1 through the forward.
# Needs the AWS CLI's Session Manager plugin; pending without it.
#
# BREAK=1 revokes the host's ingress rule on loom-db's security group (the
# rule the tunnel host stack adds), so the forward opens but the database
# never answers, and expects the query to fail. The rule is put back on exit.
set -euo pipefail

name=tunnel/rds
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }
log() { echo "[$name] $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs session-manager-plugin node)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_light_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

TUNNEL_PID="" DB_SG="" HOST_SG="" PORT_NUM=""
work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-tunnel.XXXXXX")"
on_exit() {
  [ -z "$TUNNEL_PID" ] || { kill "$TUNNEL_PID" 2>/dev/null || true; wait "$TUNNEL_PID" 2>/dev/null || true; }
  if [ -n "$DB_SG" ] && [ -n "$HOST_SG" ]; then
    aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port "$PORT_NUM" \
      --source-group "$HOST_SG" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap on_exit EXIT

BROKEN=""
stop() { # detail
  if [ -n "${BREAK:-}" ] && [ -n "$BROKEN" ]; then say caught "with the host's database ingress revoked: $1"
  elif [ -n "${BREAK:-}" ]; then say fail "BREAK could not be applied: $1"
  else say fail "$1"; fi
  exit 0
}

log "making sure loom-db and what it needs are up under $CLAIMS_AWS_PREFIX"
why="$(claims_aws_ensure loom-db)" || stop "deploy: $why"
INSTANCE="$(claims_aws_tunnel_host)" || stop "$INSTANCE"

if [ -n "${BREAK:-}" ]; then
  DB_SG="$(claims_aws_output loom-db oRdsSecurityGroupId)"
  HOST_SG="$(claims_aws_output tunnel-host oSecurityGroupId)"
  PORT_NUM="$(claims_aws_output loom-db oRdsPort)"; PORT_NUM="${PORT_NUM:-5432}"
  [ -n "$DB_SG" ] && [ -n "$HOST_SG" ] || { DB_SG=""; stop "no oRdsSecurityGroupId/oSecurityGroupId output to break"; }
  aws ec2 revoke-security-group-ingress --group-id "$DB_SG" --protocol tcp --port "$PORT_NUM" --source-group "$HOST_SG" >/dev/null \
    || { DB_SG=""; stop "could not revoke the tunnel host's ingress on $DB_SG"; }
  BROKEN=1
fi

# 2. The forward, as `just tunnel <port>` starts it.
LOCAL_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
bash scripts/tunnel.sh "$LOCAL_PORT" >"$work/tunnel.log" 2>&1 &
TUNNEL_PID=$!
open=""
for _ in $(seq 1 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null && { open=1; break; }
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  sleep 1
done
[ -n "$open" ] || stop "scripts/tunnel.sh opened nothing on 127.0.0.1:$LOCAL_PORT: $(tail -n 3 "$work/tunnel.log" | tr '\n' ' ')"

# 3. A real query through it.
secret="$(claims_aws_output loom-db oRdsCredentialsSecretArn)"
[ -n "$secret" ] || stop "loom-db has no oRdsCredentialsSecretArn output"
creds="$(aws secretsmanager get-secret-value --secret-id "$secret" --query SecretString --output text)"
dbname="$(claims_aws_output loom-db oRdsDbName)"
if CLAIM_DB_CREDS="$creds" CLAIM_DB_NAME="${dbname:-loom}" CLAIM_DB_PORT="$LOCAL_PORT" node -e '
    const { Client } = require("pg");
    const c = JSON.parse(process.env.CLAIM_DB_CREDS);
    const client = new Client({ host: "127.0.0.1", port: Number(process.env.CLAIM_DB_PORT), database: process.env.CLAIM_DB_NAME,
      user: c.username, password: c.password, connectionTimeoutMillis: 45000, ssl: { rejectUnauthorized: false } });
    client.connect().then(() => client.query("SELECT 1 AS one")).then((r) => {
      if (r.rows[0].one !== 1) throw new Error("SELECT 1 gave " + JSON.stringify(r.rows));
      return client.end();
    }).catch((e) => { console.error(e.message); process.exit(1); });' >"$work/query.log" 2>&1; then
  if [ -n "${BREAK:-}" ]; then say fail "with the host's ingress on $DB_SG revoked, SELECT 1 still answered through the tunnel"; exit 0; fi
  say pass "the tunnel host $INSTANCE came online in SSM and scripts/tunnel.sh forwarded 127.0.0.1:$LOCAL_PORT to the database, where SELECT 1 answered"
else
  stop "SELECT 1 through 127.0.0.1:$LOCAL_PORT failed: $(tail -n 1 "$work/query.log")"
fi
