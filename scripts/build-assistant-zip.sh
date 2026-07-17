#!/usr/bin/env bash
set -euo pipefail

# Build the Strands assistant agent zip and upload it to shared-foundation's
# artifact bucket, so loom-agents' code-config Runtime has a real `code.s3`
# target (loomster#128). Loom ships the assistant as a Python zip (no Dockerfile)
# and deploys it via AgentCore `create_runtime` with a code configuration; this is
# the build+upload that step needs. Runs as the loom-agents component's Build
# phase, after shared-foundation is deployed (the bucket exists) and before the
# agents stack applies.
#
# Honors AWS_ENDPOINT_URL (so it uploads to Floci's S3 on the local/emulator path)
# and LOOM_ASSISTANT_CODE_PREFIX (the object key; default strands_agent/agent.zip).

SRC="vendor/loom/agents/strands_agent"
PREFIX="${LOOM_ASSISTANT_CODE_PREFIX:-strands_agent/agent.zip}"
[ -d "$SRC" ] || { echo "build-assistant-zip: $SRC missing — run 'npm run vendor' first" >&2; exit 1; }

BUILD="$SRC/build"
rm -rf "$BUILD"
mkdir -p "$BUILD/package"
cp -r "$SRC/src" "$BUILD/package/"

# Install deps into the package dir. AgentCore's managed runtime is PYTHON_3_13;
# pure-Python deps package cleanly here. (A production build targeting native
# wheels would add --platform manylinux2014_x86_64 --only-binary=:all:.)
python3 -m venv "$BUILD/.venv"
"$BUILD/.venv/bin/pip" install --quiet --upgrade pip
"$BUILD/.venv/bin/pip" install --quiet -r "$SRC/requirements.txt" -t "$BUILD/package"

( cd "$BUILD/package" && zip -qr ../agent.zip . -x '*.pyc' '*__pycache__*' )

BUCKET=$(aws cloudformation describe-stacks --stack-name shared-foundation \
  --query "Stacks[0].Outputs[?OutputKey=='oArtifactBucket'].OutputValue | [0]" --output text)
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] || { echo "build-assistant-zip: no shared-foundation artifact bucket output (deploy shared-foundation first)" >&2; exit 1; }

aws s3 cp "$BUILD/agent.zip" "s3://$BUCKET/$PREFIX"
echo "build-assistant-zip: uploaded $BUILD/agent.zip -> s3://$BUCKET/$PREFIX"
