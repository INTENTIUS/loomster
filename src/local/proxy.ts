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
 * Loopback mode (loomster#3). Loom v1.8.1+ honours its local-dev auth bypass
 * only for a request whose client address is loopback and that carries no
 * `X-Forwarded-*`/`X-Real-IP`/`Forwarded` header. A proxy in its own container
 * reaches the backend from a Docker-network address, so every API call would
 * get a 401. With `backendOverLoopback`, the proxy joins the backend
 * container's network namespace (`network_mode: service:<backend>`) and
 * proxies to `127.0.0.1`, so the backend sees a loopback peer. The proxy then
 * has no network or ports of its own: the caller publishes the listen port on
 * the backend service (see `loopbackPublishedPort`), bound to the host's
 * loopback only, so the bypassed app is reachable from this machine and not
 * from the LAN.
 *
 * Exposed as factory functions, not top-level declarables, so `chant lint .`
 * doesn't try to build an incomplete compose graph before #49 wires the app
 * services in.
 */

import { Service } from "@intentius/chant-lexicon-docker";

type ServiceProps = NonNullable<ConstructorParameters<typeof Service>[0]>;

export interface LoomLocalProxyOptions {
  /** Host port the browsable origin is published on. Default: 8080. */
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
  /**
   * Run the proxy inside the backend container's network namespace and reach
   * the backend over 127.0.0.1 (see the file header). The caller must publish
   * `loopbackPublishedPort(listenPort)` on the backend service. Default: false.
   */
  backendOverLoopback?: boolean;
}

/** nginx listens on this port inside the container; the host port (`listenPort`) publishes to it. */
const CONTAINER_LISTEN_PORT = 8080;

/**
 * Request headers that mark a request as proxied. Loom's local-dev bypass
 * refuses any request carrying one (v1.8.1+, `auth.py` `_FORWARDING_HEADERS`).
 * nginx doesn't add them by default, but it does pass a client's own copies
 * through, so the proxy clears them (setting a header to "" drops it).
 */
const FORWARDING_HEADERS = ["X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", "Forwarded"];

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
    backendOverLoopback: opts.backendOverLoopback ?? false,
  };
}

/**
 * Generate the nginx routing config that mirrors Loom's ALB. Chant-owned and
 * derived from the ALB rules in code — the harness writes it to `configPath`;
 * it is never a hand-maintained file. `$host` is literal nginx syntax.
 */
export function buildProxyRoutingConfig(opts: LoomLocalProxyOptions = {}): string {
  const o = resolved(opts);
  const backendHost = o.backendOverLoopback ? "127.0.0.1" : o.backendService;
  const backend = `http://${backendHost}:${o.servicePort}`;
  const frontend = `http://${o.frontendService}:${o.servicePort}`;
  const extra = (opts.extraLocations ?? []).map((l) => `    ${l}`);
  const clearForwarding = FORWARDING_HEADERS.map((h) => `proxy_set_header ${h} "";`).join(" ");
  return [
    "events {}",
    "http {",
    "  server {",
    `    listen ${CONTAINER_LISTEN_PORT};`,
    "    # Mirrors Loom's ALB listener rule: /api/* and /health -> backend, default -> frontend SPA.",
    "    # Forwarding headers are cleared: Loom's local-dev auth bypass rejects any request carrying one.",
    `    location /api/ { proxy_pass ${backend}; proxy_set_header Host $host; ${clearForwarding} }`,
    `    location = /health { proxy_pass ${backend}; ${clearForwarding} }`,
    ...extra,
    `    location / { proxy_pass ${frontend}; proxy_set_header Host $host; }`,
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * The host port mapping for loopback mode, to put on the backend service: the
 * proxy listens inside the backend's network namespace, so the backend service
 * owns the published port. Bound to the host's 127.0.0.1 so the auth-bypassed
 * app isn't reachable from other machines.
 */
export function loopbackPublishedPort(listenPort = 8080): string {
  return `127.0.0.1:${listenPort}:${CONTAINER_LISTEN_PORT}`;
}

/**
 * The proxy compose `Service`. The harness (#49) writes `buildProxyRoutingConfig`
 * to `configPath` (bind-mounted read-only) and adds the referenced
 * backend/frontend services + the shared network to the same graph.
 */
export function loomLocalProxy(opts: LoomLocalProxyOptions = {}): InstanceType<typeof Service> {
  const o = resolved(opts);
  const volumes = [`${o.configPath}:/etc/nginx/nginx.conf:ro`];
  const depends_on = [o.backendService, o.frontendService];
  if (o.backendOverLoopback) {
    // `network_mode` isn't in the docker lexicon's generated ServiceProps; the
    // serializer emits every prop it's given, so widen the type here.
    const props: ServiceProps & { network_mode: string } = {
      image: "nginx:1.27-alpine",
      network_mode: `service:${o.backendService}`,
      volumes,
      depends_on,
      restart: "unless-stopped",
    };
    return new Service(props);
  }
  return new Service({
    image: "nginx:1.27-alpine",
    ports: [`${o.listenPort}:${CONTAINER_LISTEN_PORT}`],
    volumes,
    depends_on,
    networks: [o.network],
    restart: "unless-stopped",
  });
}
