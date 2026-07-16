/**
 * Build the runtime-E2E Forgejo Actions workflow and write it into the output
 * directory passed as argv[2] — the Forgejo counterpart to
 * `../github-runtime-e2e/build.ts`. Forgejo Actions is a GitHub-Actions
 * dialect, so this runs via `act` the same way the github fixture does.
 *
 * Targets local execution via act, like the github fixture:
 *  - `image: node:22` (not `-slim`) so `checkout` has `git`.
 *  - `beforeScript` installs `awscli`, runs `npm ci` (loomster consumes
 *    published chant from npm), and `npm run synth`.
 *  - `runCommand` invokes chant through `npx`.
 *
 * Scoped to the 4 `infra`-archetype components that need no Docker build
 * context; `loom-backend`/`loom-frontend` build Loom's real images from
 * `vendor/loom`, a separate concern. Explicit-invocation guard so chant's
 * whole-project discovery doesn't trip on the module-level side effect.
 */

import { generateForgejoPipeline } from "@intentius/chant-lexicon-forgejo/components/generate-pipeline";
import type { DriverComponent } from "@intentius/chant/components";
import { sharedFoundation } from "../../src/components/shared-foundation.component";
import { loomCognito } from "../../src/components/loom-cognito.component";
import { loomDb } from "../../src/components/loom-db.component";
import { downstreamStub } from "../../src/components/downstream-stub.component";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function buildWorkflow(outDir: string): void {
  const components: DriverComponent[] = [sharedFoundation, loomCognito, loomDb, downstreamStub];

  const { yaml } = generateForgejoPipeline(components, {
    env: "local",
    image: "node:22",
    beforeScript: [
      "apt-get update -qq && apt-get install -y -qq awscli git >/dev/null 2>&1",
      "npm ci --no-audit --no-fund",
      "npm run synth",
    ],
    runCommand: ["npx", "chant", "run", "--components", "{name}", "--env", "local"],
  });

  // The committed pipeline resolves actions from Forgejo's own registry
  // (`https://code.forgejo.org/actions/...`), which a real Forgejo runner
  // (act_runner) understands. `act` — a GitHub-flavoured runner — only accepts
  // the short `{org}/{repo}@ref` form, so for this act-driven E2E rewrite the
  // action host to the equivalent short refs (the actions are functionally
  // identical; this changes only where the runner fetches them, not the
  // job/needs/artifact mechanics under test).
  const actYaml = yaml.replace(/uses: https:\/\/code\.forgejo\.org\/actions\//g, "uses: actions/");

  const dest = join(outDir, "ci.yml");
  writeFileSync(dest, actYaml);
  console.log(`wrote ${dest}`);
  console.log(yaml);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  buildWorkflow(process.argv[2] ?? "test/forgejo-runtime-e2e");
}
