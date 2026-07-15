/**
 * Writes the generated nginx routing config (#48's `buildProxyRoutingConfig`)
 * next to the generated compose file, for the local-run harness (#49). The
 * config is chant-owned (derived from Loom's ALB rules in code), never a
 * hand-maintained file. Service names match the compose keys in
 * `../../src/local/compose.ts` (docker DNS resolves them).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { buildProxyRoutingConfig } from "../../src/local/proxy";

const OUT_DIR = "dist/local";
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/nginx.local.conf`,
  buildProxyRoutingConfig({ backendService: "loomBackend", frontendService: "loomFrontend", servicePort: 8000 }),
);
console.log(`wrote ${OUT_DIR}/nginx.local.conf`);
