/**
 * The local-run compose graph (#49, part of the local-tier epic #45) — the
 * app tier (frontend + backend) plus the reverse proxy (#48) and a shared
 * network, declared via the docker lexicon and serialized to
 * `docker-compose.yml` by `chant build src/local --lexicon docker`
 * (chant-generated, never hand-authored).
 *
 * The AWS-managed pieces (RDS, Cognito, S3, ECR) are provisioned separately by
 * chant against Floci; this graph runs only the app containers, wired to that
 * infra via environment values the harness (`just local-up`) resolves and
 * writes to a `.env` file that `docker compose` interpolates (the docker
 * lexicon's `env()`).
 *
 * Service keys are the export names below (docker DNS resolves them), which is
 * why the proxy is pointed at `loomBackend`/`loomFrontend`.
 */

import { Service, Network, env } from "@intentius/chant-lexicon-docker";
import { loomLocalProxy, loopbackPublishedPort } from "./proxy";

const NETWORK = "loomNet";
const LISTEN_PORT = 8080;

/**
 * Shared network — app services + proxy resolve each other by name, and Floci
 * (the AWS emulator, incl. the RDS proxy) is attached to it by the harness so
 * the backend can reach the database. External + pre-created by `local-up.sh`
 * (`loom-local-net`): Docker isolates separate bridges, so the app tier and
 * Floci must share one network.
 */
export const loomNet = new Network({ external: true, name: "loom-local-net" });

/** Backend (FastAPI). Image built by the harness; env wired from resolved Floci values. */
export const loomBackend = new Service({
  image: env("LOOM_BACKEND_IMAGE", { default: "loom-local-backend:latest" }),
  environment: {
    LOOM_DATABASE_URL: env("LOOM_DATABASE_URL"),
    // LOOM_COGNITO_USER_POOL_ID is deliberately unset on the local tier (#50,
    // re-checked in loomster#3). Floci's Cognito now issues RS256 JWTs and
    // serves a JWKS, but Loom can't validate them: its Cognito validator
    // hardcodes the issuer/JWKS to https://cognito-idp.<region>.amazonaws.com,
    // and its generic OIDC path fetches JWKS through net_guard.safe_get, which
    // (v1.7.0+) only allows https to public addresses. Floci (even with its
    // TLS on) sits on a private Docker address, and its access tokens carry
    // no `aud`, which that path checks. The frontend's Cognito login also posts
    // to the real cognito-idp.<region>.amazonaws.com. So the local tier runs Loom's own
    // dev bypass: with no pool id and no active external IdP, every request is
    // a `local-dev` user with the admin groups + all scopes.
    // v1.6.1+ needs the explicit opt-in below; v1.8.1+ also requires a
    // loopback client and no forwarding headers, which the proxy provides by
    // running in this container's network namespace (see ./proxy.ts). Earlier
    // versions ignore the variable. awslabs/loom#79 plans to remove the bypass.
    // Production/production-ha use the real Cognito pool.
    LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV: "true",
    LOOM_COGNITO_REGION: env("AWS_REGION", { default: "us-east-1" }),
    LOOM_ARTIFACT_BUCKET: env("LOOM_ARTIFACT_BUCKET"),
    AWS_ENDPOINT_URL: env("AWS_ENDPOINT_URL"),
    AWS_REGION: env("AWS_REGION", { default: "us-east-1" }),
    AWS_ACCESS_KEY_ID: env("AWS_ACCESS_KEY_ID", { default: "test" }),
    AWS_SECRET_ACCESS_KEY: env("AWS_SECRET_ACCESS_KEY", { default: "test" }),
    LOOM_ALLOWED_ORIGINS: env("LOOM_ALLOWED_ORIGINS", { default: "http://localhost:8080" }),
    LOG_LEVEL: "info",
  },
  // The proxy shares this container's network namespace (loopback mode), so
  // its listener is published here, on the host's 127.0.0.1 only.
  ports: [loopbackPublishedPort(LISTEN_PORT)],
  networks: [NETWORK],
  restart: "unless-stopped",
});

/** Frontend (nginx-served SPA). Built by the harness; static, no runtime env. */
export const loomFrontend = new Service({
  image: env("LOOM_FRONTEND_IMAGE", { default: "loom-local-frontend:latest" }),
  networks: [NETWORK],
  restart: "unless-stopped",
});

/**
 * Reverse proxy (#48) — one browsable origin, mirrors Loom's ALB routing. Runs
 * in the backend's network namespace and reaches it over 127.0.0.1 (#3), so
 * Loom v1.8.1+ treats proxied requests as loopback for its dev-auth bypass.
 */
export const loomProxy = loomLocalProxy({
  listenPort: LISTEN_PORT,
  backendOverLoopback: true,
  backendService: "loomBackend",
  frontendService: "loomFrontend",
  servicePort: 8000,
  network: NETWORK,
  configPath: "./nginx.local.conf",
});
