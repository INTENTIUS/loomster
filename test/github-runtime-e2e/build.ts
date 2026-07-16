/**
 * Build the runtime-E2E GitHub Actions workflow and write it into the output
 * directory passed as argv[2] — the `act` counterpart to
 * `../gitlab-runtime-e2e/build.ts`.
 *
 * Unlike the committed `.github/workflows/components.yml` (the real workflow a
 * team runs, `npm run generate:github` — default `node:22-slim` image, no setup
 * steps, assuming a runner image with `chant` + `awscli` preinstalled), this
 * fixture targets **local execution via act**:
 *  - `image: node:22` (not `-slim`) so `actions/checkout` has `git`.
 *  - `beforeScript` installs `awscli` (cfn-deploy shells out to it; the node
 *    image doesn't ship it), runs `npm ci` (loomster consumes published chant
 *    from npm, so no sibling checkout is needed), and `npm run synth` (the
 *    gitignored `dist/*.template.json` each `chant run` applies).
 *  - `runCommand` invokes chant through `npx`.
 *
 * Scoped to the 4 `infra`-archetype components that need no Docker build
 * context (`shared-foundation`, `loom-cognito`, `loom-db`, `downstream-stub`);
 * `loom-backend`/`loom-frontend` build Loom's real images from `vendor/loom`,
 * a separate, heavier concern than proving the generated workflow's
 * job/`needs:`/artifact mechanics execute against a real endpoint.
 *
 * Explicit-invocation guard (mirrors the gitlab fixture): `buildWorkflow()`
 * only runs when this module is executed directly, never on a discovery-driven
 * `import()`, so chant's whole-project walk doesn't trip on a module-level
 * side effect.
 */

import { generateGithubPipeline } from "@intentius/chant-lexicon-github/components/generate-pipeline";
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

  const { yaml } = generateGithubPipeline(components, {
    env: "local",
    image: "node:22",
    beforeScript: [
      "apt-get update -qq && apt-get install -y -qq awscli git >/dev/null 2>&1",
      "npm ci --no-audit --no-fund",
      "npm run synth",
    ],
    runCommand: ["npx", "chant", "run", "--components", "{name}", "--env", "local"],
  });

  const dest = join(outDir, "ci.yml");
  writeFileSync(dest, yaml);
  console.log(`wrote ${dest}`);
  console.log(yaml);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  buildWorkflow(process.argv[2] ?? "test/github-runtime-e2e");
}
