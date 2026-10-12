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
    // Real Cognito login against Floci (loomster#58). local-up resolves the
    // loom-cognito stack's pool on Floci and points Loom's Cognito validator at
    // Floci instead of cognito-idp.<region>.amazonaws.com with
    // LOOM_COGNITO_ENDPOINT_URL, an opt-in override loomster patches into the
    // vendored Loom (scripts/loom-patches/). Floci runs with FLOCI_HOSTNAME=floci,
    // so the tokens' issuer is http://floci:4566/<pool>, the same base the
    // backend fetches the JWKS from on this network. The local-dev auth bypass
    // (LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV) is off.
    LOOM_COGNITO_USER_POOL_ID: env("LOOM_COGNITO_USER_POOL_ID"),
    LOOM_COGNITO_ENDPOINT_URL: env("LOOM_COGNITO_ENDPOINT_URL"),
    LOOM_COGNITO_REGION: env("AWS_REGION", { default: "us-east-1" }),
    LOOM_ARTIFACT_BUCKET: env("LOOM_ARTIFACT_BUCKET"),
    AWS_ENDPOINT_URL: env("AWS_ENDPOINT_URL"),
    AWS_REGION: env("AWS_REGION", { default: "us-east-1" }),
    // loom-backend's task role session when local-up runs Floci with IAM
    // enforcement (LOOM_LOCAL_IAM_ENFORCEMENT=true, loomster#53), so Floci
    // checks Loom's calls against the role's policies; Floci's unchecked
    // `test` key otherwise (the default).
    AWS_ACCESS_KEY_ID: env("AWS_ACCESS_KEY_ID", { default: "test" }),
    AWS_SECRET_ACCESS_KEY: env("AWS_SECRET_ACCESS_KEY", { default: "test" }),
    AWS_SESSION_TOKEN: env("AWS_SESSION_TOKEN", { default: "" }),
    LOOM_ALLOWED_ORIGINS: env("LOOM_ALLOWED_ORIGINS", { default: "http://localhost:8080" }),
    LOG_LEVEL: "info",
  },
  networks: [NETWORK],
  restart: "unless-stopped",
});

/**
 * Frontend (nginx-served SPA). Built by the harness with the Floci user client
 * id and VITE_COGNITO_ENDPOINT_URL (the login form posts to the proxy's
 * /floci-cognito/ path, which forwards to Floci); static, no runtime env.
 */
export const loomFrontend = new Service({
  image: env("LOOM_FRONTEND_IMAGE", { default: "loom-local-frontend:latest" }),
  networks: [NETWORK],
  restart: "unless-stopped",
});

/**
 * Reverse proxy (#48) — one browsable origin, mirrors Loom's ALB routing, on
 * the host's 127.0.0.1 only.
 */
export const loomProxy = loomLocalProxy({
  listenPort: LISTEN_PORT,
  backendService: "loomBackend",
  frontendService: "loomFrontend",
  servicePort: 8000,
  network: NETWORK,
  configPath: "./nginx.local.conf",
});
