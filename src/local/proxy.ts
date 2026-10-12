/**
 * Local-run reverse proxy (#48, part of the local-tier epic #45) — stands in
 * for Loom's ALB so the local run has a single browsable origin. Declared via
 * the docker lexicon (`@intentius/chant-lexicon-docker`): the compose harness
 * (#49) assembles this proxy `Service` alongside the frontend/backend services
 * and serializes the whole graph to `docker-compose.yml` (chant-generated,
 * never hand-authored).
 *
 * The routing mirrors Loom's real ALB listener rule, verified from
 * `awslabs/loom` `shared/iac/infra.yaml` (`ListenerRule` priority 1):
 *   path-pattern `/api/*` OR `/health` → backend target group
 *   default (everything else)          → frontend target group
 * The frontend calls the backend same-origin (loomster builds it with an empty
 * `VITE_API_BASE_URL`), so this single-origin path proxy needs no rebuild.
 *
 * The proxy runs in its own container on the shared network and reaches the
 * backend by service name. (Until loomster#58 it ran in the backend's network
 * namespace so Loom's local-dev auth bypass saw a loopback client; local now
 * logs in through Floci's Cognito, so nothing needs a loopback peer.) The
 * published port binds the host's 127.0.0.1 only: the local run is for this
 * machine, with a throwaway admin password, not for the LAN.
 *
 * Exposed as factory functions, not top-level declarables, so `chant lint .`
 * doesn't try to build an incomplete compose graph before #49 wires the app
 * services in.
 */

import { Service } from "@intentius/chant-lexicon-docker";

export interface LoomLocalProxyOptions {
  /** Host port the browsable origin is published on (host 127.0.0.1 only). Default: 8080. */
  listenPort?: number;
  /** Backend compose service name. Default: "loom-backend". */
  backendService?: string;
  /** Frontend compose service name. Default: "loom-frontend". */
  frontendService?: string;
  /** Container port both app services listen on (Loom uses 8000 for both). Default: 8000. */
  servicePort?: number;
  /** Shared compose network the app services + proxy join. Default: "loom-local". */
  network?: string;
  /** Path (relative to the compose file) the harness writes the generated nginx config to. Default: "./nginx.local.conf". */
  configPath?: string;
  /** Extra nginx `location` blocks injected into the server (e.g. the local demo's static A2A agent card). Kept separate from the ALB-mirror routing above. */
  extraLocations?: string[];
}

/** nginx listens on this port inside the container; the host port (`listenPort`) publishes to it. */
const CONTAINER_LISTEN_PORT = 8080;

/**
 * Apply defaults per field with `??` (not a `{ ...DEFAULTS, ...opts }` spread —
 * chant's EVL004 forbids spreading a non-const, and `opts` is a parameter).
 */
function resolved(opts: LoomLocalProxyOptions): Required<Omit<LoomLocalProxyOptions, "extraLocations">> {
  return {
    listenPort: opts.listenPort ?? 8080,
    backendService: opts.backendService ?? "loom-backend",
    frontendService: opts.frontendService ?? "loom-frontend",
    servicePort: opts.servicePort ?? 8000,
    network: opts.network ?? "loom-local",
    configPath: opts.configPath ?? "./nginx.local.conf",
  };
}

/**
 * Generate the nginx routing config that mirrors Loom's ALB. Chant-owned and
 * derived from the ALB rules in code — the harness writes it to `configPath`;
 * it is never a hand-maintained file. `$host` is literal nginx syntax.
 */
export function buildProxyRoutingConfig(opts: LoomLocalProxyOptions = {}): string {
  const o = resolved(opts);
  const backend = `http://${o.backendService}:${o.servicePort}`;
  const frontend = `http://${o.frontendService}:${o.servicePort}`;
  const extra = (opts.extraLocations ?? []).map((l) => `    ${l}`);
  return [
    "events {}",
    "http {",
    "  server {",
    `    listen ${CONTAINER_LISTEN_PORT};`,
    "    # Mirrors Loom's ALB listener rule: /api/* and /health -> backend, default -> frontend SPA.",
    `    location /api/ { proxy_pass ${backend}; proxy_set_header Host $host; }`,
    `    location = /health { proxy_pass ${backend}; }`,
    ...extra,
    `    location / { proxy_pass ${frontend}; proxy_set_header Host $host; }`,
    "  }",
    "}",
    "",
  ].join("\n");
}

/** The proxy's host port mapping: bound to the host's 127.0.0.1 so the local app isn't reachable from other machines. */
export function localPublishedPort(listenPort = 8080): string {
  return `127.0.0.1:${listenPort}:${CONTAINER_LISTEN_PORT}`;
}

/**
 * The proxy compose `Service`. The harness (#49) writes `buildProxyRoutingConfig`
 * to `configPath` (bind-mounted read-only) and adds the referenced
 * backend/frontend services + the shared network to the same graph.
 */
export function loomLocalProxy(opts: LoomLocalProxyOptions = {}): InstanceType<typeof Service> {
  const o = resolved(opts);
  return new Service({
    image: "nginx:1.27-alpine",
    ports: [localPublishedPort(o.listenPort)],
    volumes: [`${o.configPath}:/etc/nginx/nginx.conf:ro`],
    depends_on: [o.backendService, o.frontendService],
    networks: [o.network],
    restart: "unless-stopped",
  });
}
