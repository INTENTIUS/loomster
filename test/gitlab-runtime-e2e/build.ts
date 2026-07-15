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
 */

import { generateGitlabPipeline } from "@intentius/chant-lexicon-gitlab/components/generate-pipeline";
import type { DriverComponent } from "@intentius/chant/components";
import { sharedFoundation } from "../../src/components/shared-foundation.component";
import { loomCognito } from "../../src/components/loom-cognito.component";
import { loomDb } from "../../src/components/loom-db.component";
import { downstreamStub } from "../../src/components/downstream-stub.component";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "test/gitlab-runtime-e2e";

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
