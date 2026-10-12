#!/usr/bin/env bash
# target: floci
# tier: light
# summary: loom-seed on the demo profile reports a verdict per step and exits non-zero when a demo step fails
#
# Not built yet. It needs a running Loom on Floci (`just local-up`, which
# binds :4566 and :8080 and runs for minutes; image
# ${LOOM_CLAIMS_FLOCI_IMAGE:-ghcr.io/lex00/floci:318204f}), then:
#   plain   run `LOOM_SEED_PROFILE=demo npm run seed`, expect every step
#           verdict=ok|present and exit 0;
#   BREAK   point LOOM_API_BASE_URL's demo calls at a path that 404s (or stop
#           the backend after the foundation steps), expect a step
#           verdict=failed and a non-zero exit.
# What Floci cannot prove: IAM. The emulator does not enforce the backend task
# role, so a pass here says nothing about backend/deploy-agent on real AWS.
set -euo pipefail
echo "CLAIM claim=seed/demo-loud verdict=pending needs a local-up Loom on Floci (${LOOM_CLAIMS_FLOCI_IMAGE:-ghcr.io/lex00/floci:318204f}, just local-up) to run loom-seed's demo profile against; not built yet"
