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

// A static A2A agent card served from the proxy, so the demo seed (loom-seed)
// can register a real A2A agent and the Catalog's A2A section isn't empty. The
// backend fetches `<base_url>/.well-known/agent.json`; base_url is the proxy at
// `http://loomProxy:8080/a2a-demo` (LOOM_DEMO_A2A_URL, set by local-up.sh).
const A2A_CARD = JSON.stringify({
  name: "Loomster Demo A2A",
  description: "A demo agent-to-agent integration seeded by loomster",
  version: "1.0.0",
  url: "http://loomProxy:8080/a2a-demo",
  capabilities: {},
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [],
});
const a2aCardLocation = `location = /a2a-demo/.well-known/agent.json { default_type application/json; return 200 '${A2A_CARD}'; }`;

writeFileSync(
  `${OUT_DIR}/nginx.local.conf`,
  buildProxyRoutingConfig({ backendService: "loomBackend", frontendService: "loomFrontend", servicePort: 8000, extraLocations: [a2aCardLocation] }),
);
console.log(`wrote ${OUT_DIR}/nginx.local.conf`);
