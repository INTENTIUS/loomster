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
import { loomLocalProxy } from "./proxy";

const NETWORK = "loomNet";

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
    LOOM_COGNITO_USER_POOL_ID: env("LOOM_COGNITO_USER_POOL_ID"),
    LOOM_COGNITO_REGION: env("AWS_REGION", { default: "us-east-1" }),
    LOOM_ARTIFACT_BUCKET: env("LOOM_ARTIFACT_BUCKET"),
    AWS_ENDPOINT_URL: env("AWS_ENDPOINT_URL"),
    AWS_REGION: env("AWS_REGION", { default: "us-east-1" }),
    AWS_ACCESS_KEY_ID: env("AWS_ACCESS_KEY_ID", { default: "test" }),
    AWS_SECRET_ACCESS_KEY: env("AWS_SECRET_ACCESS_KEY", { default: "test" }),
    LOOM_ALLOWED_ORIGINS: env("LOOM_ALLOWED_ORIGINS", { default: "http://localhost:8080" }),
    LOG_LEVEL: "info",
  },
  networks: [NETWORK],
  restart: "unless-stopped",
});

/** Frontend (nginx-served SPA). Built by the harness; static, no runtime env. */
export const loomFrontend = new Service({
  image: env("LOOM_FRONTEND_IMAGE", { default: "loom-local-frontend:latest" }),
  networks: [NETWORK],
  restart: "unless-stopped",
});

/** Reverse proxy (#48) — one browsable origin, mirrors Loom's ALB routing. */
export const loomProxy = loomLocalProxy({
  listenPort: 8080,
  backendService: "loomBackend",
  frontendService: "loomFrontend",
  servicePort: 8000,
  network: NETWORK,
  configPath: "./nginx.local.conf",
});
