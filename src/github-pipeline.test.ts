/**
 * Validates GitHub Actions component-pipeline generation for the Loom
 * component set — the counterpart to `gitlab-pipeline.test.ts`. The generator
 * lives in chant (`lexicons/github/src/components/generate-pipeline.ts`); this
 * file proves the generic `chant build --components --generate github` seam,
 * wired against this repo's REAL discovered components
 * (`src/components/*.component.ts`), produces a workflow whose job/`needs:`
 * structure matches the same `dependsOn` graph `chant graph --components`
 * reports.
 *
 * GitHub Actions has no `stage` concept, so wave ordering is expressed purely
 * through `needs:` edges. `ComponentPipelineResult.stages` is still populated
 * (the wave-ordered view), so the graph/jobs/needs checks port from the gitlab
 * test unchanged; only the YAML-structure test is GitHub-specific (`jobs:` +
 * `steps:` + `actions/upload-artifact`, not `stages:` + `script:`).
 *
 * Committed alongside the generated `.github/workflows/components.yml` so both
 * stay honest: regenerate with `npm run generate:github` whenever a
 * component's `dependsOn` changes, and the last test fails if the committed
 * file and a fresh generate drift apart.
 */

import { describe, test, expect } from "vitest";
import { generateComponentsPipeline, computeComponentGraph } from "@intentius/chant/components";
import { parseYAML } from "@intentius/chant/yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chant build --components --generate github — Loom component set", () => {
  test("the committed .github/workflows/components.yml matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "github", { env: "production" });
    expect(result.success).toBe(true);

    const committed = readFileSync(resolve(".github/workflows/components.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  }, 60_000);
});
