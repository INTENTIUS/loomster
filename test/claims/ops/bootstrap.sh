#!/usr/bin/env bash
# target: aws
# tier: any
# order: 10
# summary: chant run loom-bootstrap leaves the account with the ECS and AgentCore runtime-identity service-linked roles, and a second run changes nothing
#
# The docs say to run `just bootstrap` once per account before the first
# deploy (#38): it creates the two service-linked roles Loom's make
# ecs.init/agentcore.init create, only when missing, and fails loudly when it
# cannot. Plain runs the Op twice on the real account and checks:
#   - both runs succeed;
#   - after them, AWSServiceRoleForECS and
#     AWSServiceRoleForBedrockAgentCoreRuntimeIdentity exist;
#   - the second run looks both up and creates nothing (an aws wrapper logs
#     the calls the Op makes and passes each one to the real CLI).
# It deploys nothing, so it needs no claims instance and runs first.
#
# BREAK=1 checks the other half of the property, the loud failure: it runs the
# same Op with an `aws` first on PATH that reports neither role and refuses
# iam:CreateServiceLinkedRole with AccessDenied (what a principal without that
# permission gets), and expects the Op to fail and say so. Denying a real
# permission would mean editing the operator's own identity, which a claim
# must not do; this wrapper changes nothing on the account.
set -euo pipefail

name=ops/bootstrap
say() { echo "CLAIM claim=$name verdict=$1${2:+ $2}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# shellcheck source=test/claims-aws.sh
. "$ROOT/test/claims-aws.sh"
why="$(claims_aws_needs)"
[ -z "$why" ] || { say pending "$why"; exit 0; }
claims_aws_env || { say fail "no claims prefix (test/claims-aws.sh prefix)"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/loomster-claim-bootstrap.XXXXXX")"
trap 'rm -rf "$work"' EXIT
run_op() { claims_chant ./node_modules/.bin/chant run loom-bootstrap; }

if [ -n "${BREAK:-}" ]; then
  real_aws="$(command -v aws)"
  mkdir -p "$work/bin"
  cat >"$work/bin/aws" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"iam list-roles"*) echo None ;;
  *"iam create-service-linked-role"*)
    echo "An error occurred (AccessDenied) when calling the CreateServiceLinkedRole operation: not authorized to perform: iam:CreateServiceLinkedRole" >&2; exit 254 ;;
  *) exec "$real_aws" "\$@" ;;
esac
EOF
  chmod +x "$work/bin/aws"
  if PATH="$work/bin:$PATH" run_op >"$work/break.log" 2>&1; then
    say fail "with iam:CreateServiceLinkedRole refused and no role present, loom-bootstrap still succeeded"
  elif grep -q "AccessDenied" "$work/break.log"; then
    say caught "with iam:CreateServiceLinkedRole refused and no role present, loom-bootstrap failed with AccessDenied"
  else
    say caught "with iam:CreateServiceLinkedRole refused and no role present, loom-bootstrap failed ($(tail -n 1 "$work/break.log"))"
  fi
  exit 0
fi

# The real aws, behind a wrapper that logs each call the Op makes (chant does
# not print a step's output), so the second run's calls can be counted.
real_aws="$(command -v aws)"
mkdir -p "$work/bin"
cat >"$work/bin/aws" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"\${CLAIM_AWS_CALLS:-/dev/null}"
exec "$real_aws" "\$@"
EOF
chmod +x "$work/bin/aws"
CLAIM_AWS_CALLS="$work/first.calls" PATH="$work/bin:$PATH" run_op >"$work/first.log" 2>&1 \
  || { say fail "the first loom-bootstrap run failed: $(grep -m1 -iE 'error|denied|fail' "$work/first.log" || tail -n 1 "$work/first.log")"; exit 0; }
CLAIM_AWS_CALLS="$work/second.calls" PATH="$work/bin:$PATH" run_op >"$work/second.log" 2>&1 \
  || { say fail "the second loom-bootstrap run failed: $(tail -n 1 "$work/second.log")"; exit 0; }
problems=""
for role in AWSServiceRoleForECS AWSServiceRoleForBedrockAgentCoreRuntimeIdentity; do
  aws iam get-role --role-name "$role" >/dev/null 2>&1 || problems="$problems $role is missing after the runs;"
done
looked="$(grep -c "iam list-roles" "$work/second.calls" 2>/dev/null || true)"
[ "${looked:-0}" -ge 2 ] || problems="$problems the second run looked up ${looked:-0} of 2 roles;"
created="$(grep -c "create-service-linked-role" "$work/second.calls" 2>/dev/null || true)"
[ "${created:-0}" = 0 ] || problems="$problems the second run called create-service-linked-role $created time(s);"
if [ -n "$problems" ]; then problems="${problems# }"; say fail "${problems%;}"
else say pass "both service-linked roles exist after loom-bootstrap, and the second run found both and created nothing"; fi
