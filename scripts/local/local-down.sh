#!/usr/bin/env bash
# Tear down the local run (#49). Stops the app compose stack and Floci.
set -uo pipefail
OUT=dist/local
[ -f "$OUT/docker-compose.yml" ] && docker compose --project-name loom-local -f "$OUT/docker-compose.yml" down 2>/dev/null || true
docker rm -f floci $(docker ps -aq --filter name=floci-ecs) $(docker ps -aq --filter name=floci-rds) >/dev/null 2>&1 || true
docker network rm loom-local-net >/dev/null 2>&1 || true
echo "local run torn down"
