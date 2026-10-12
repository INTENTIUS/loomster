#!/usr/bin/env bash
# Tear down the local run (#49). Stops the app compose stack and Floci.
set -uo pipefail
OUT=dist/local
NET=loom-local-net
[ -f "$OUT/docker-compose.yml" ] && docker compose --project-name loom-local -f "$OUT/docker-compose.yml" down 2>/dev/null || true
docker rm -f floci >/dev/null 2>&1 || true
# Floci starts its RDS/ECS/ECR containers on loom-local-net (local-up sets
# FLOCI_SERVICES_DOCKER_NETWORK), so whatever is still attached is ours. Scoping
# by network and namespace rather than by a bare `floci-` prefix leaves any
# other Floci on this daemon alone.
ids="$(docker ps -aq --filter "network=$NET")"
[ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1
docker network rm "$NET" >/dev/null 2>&1 || true
# Floci's data volumes (RDS, the ECR registry) carry the namespace local-up gives
# it (FLOCI_DOCKER_RESOURCE_NAMESPACE=loom-local).
vols="$(docker volume ls -q --filter name=floci-aws-loom-local-)"
[ -n "$vols" ] && docker volume rm $vols >/dev/null 2>&1
echo "local run torn down"
