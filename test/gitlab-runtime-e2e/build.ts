/**
 * Build the runtime-E2E pipeline (chant#892) and write the generated
 * `.gitlab-ci.yml` into the output directory passed as argv[2].
 *
 * Unlike the committed `.gitlab-ci.yml` at the repo root (the real pipeline a
 * team would run, `npm run generate:gitlab` — default `chant` image + no
 * `beforeScript`, assuming a CI runner image with `chant` preinstalled), this
 * fixture targets **local Docker execution via gitlab-ci-local**: `beforeScript`
 * runs `npm ci` so `node_modules/.bin/chant` exists inside the job container
 * (bind-mounted from this checkout), and `runCommand` invokes it through `npx`.
 * Mirrors chant's own `test/gitlab-runtime-e2e/build.ts` pattern of a
 * runtime-only pipeline variant, kept out of `src/` so component discovery
 * doesn't pick this file up as a component.
 *
 * Scoped to the 4 `infra`-archetype components that don't need a Docker build
 * context (`shared-foundation`, `loom-cognito`, `loom-db`, `downstream-stub`)
 * — `loom-backend`/`loom-frontend` build Loom's real application images from
 * `vendor/loom` (not vendored here, see their component docstrings), which is
 * a separate, heavier concern than proving the generated pipeline's
 * stage/needs/artifact mechanics actually execute against a real endpoint.
 *
 * **Explicit-invocation guard (chant#928).** Being kept out of `src/` stops
 * *component* discovery from picking this file up, but chant's whole-project
 * `chant build`/`chant lifecycle snapshot|diff` (no `--src`/`sourceDir`
 * scoping) walks every non-test `.ts` file from the project root, including
 * this one under `test/`, and dynamically imports it to collect its exports
 * — so a bare module-top-level side effect here (`writeFileSync` against a
 * `process.argv[2]`-relative path meant for a standalone `npx tsx
 * test/gitlab-runtime-e2e/build.ts <outDir>` invocation) ran during that
 * walk too, failing with `ENOENT` (no `argv[2]`, `build/` doesn't exist).
 * `buildPipeline()` below only runs when this module is executed directly,
 * never on a discovery-driven `import()`.
 */

import { generateGitlabPipeline } from "@intentius/chant-lexicon-gitlab/components/generate-pipeline";
import type { DriverComponent } from "@intentius/chant/components";
import { sharedFoundation } from "../../src/components/shared-foundation.component";
import { loomCognito } from "../../src/components/loom-cognito.component";
import { loomDb } from "../../src/components/loom-db.component";
import { downstreamStub } from "../../src/components/downstream-stub.component";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function buildPipeline(outDir: string): void {
  const components: DriverComponent[] = [sharedFoundation, loomCognito, loomDb, downstreamStub];

  const { yaml } = generateGitlabPipeline(components, {
    env: "local",
    // Cross-cutting `beforeScript` (see this generator's own docstring: edited
    // once here, reflected in every job, never inlined per component):
    //  - cfn-deploy shells out to the `aws` CLI (aws lexicon's cloud-executor.ts);
    //    node:22-slim doesn't ship it.
    //  - `dist/*.template.json` is gitignored (never committed), so each job's
    //    isolated checkout needs it re-synthesized before `chant run` — a real
    //    adopting team would either bake both into a custom runner image or, as
    //    here, do it in `beforeScript`/a prior CI stage (documented in README.md).
    beforeScript: [
      "apt-get update -qq && apt-get install -y -qq awscli >/dev/null 2>&1",
      "npm ci --no-audit --no-fund",
      "npm run synth",
    ],
    runCommand: ["npx", "chant", "run", "--components", "{name}", "--env", "local"],
  });

  const dest = join(outDir, ".gitlab-ci.yml");
  writeFileSync(dest, yaml);
  console.log(`wrote ${dest}`);
  console.log(yaml);
}

// True only when this file is the script node/tsx was invoked on directly —
// false for chant discovery's `import(path)` (packages/core/src/discovery/import.ts),
// where `process.argv[1]` is the `chant` CLI entrypoint, not this file.
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  buildPipeline(process.argv[2] ?? "test/gitlab-runtime-e2e");
}
