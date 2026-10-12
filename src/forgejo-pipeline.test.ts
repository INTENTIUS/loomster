/**
 * Validates Forgejo Actions component-pipeline generation for the Loom
 * component set — the Forgejo counterpart to `github-pipeline.test.ts`. Forgejo
 * Actions is a GitHub-Actions dialect, so the generic `chant build --components
 * --generate forgejo` seam produces the same job/`needs:`/artifact structure,
 * with Forgejo specifics: `runs-on: docker` and actions resolved from
 * `code.forgejo.org`.
 *
 * Committed alongside the generated `.forgejo/workflows/components.yml`;
 * regenerate with `npm run generate:forgejo` whenever a component's `dependsOn`
 * changes, and the last test fails if the committed file drifts from a fresh
 * generate.
 */

import { describe, test, expect } from "vitest";
import { generateComponentsPipeline, computeComponentGraph } from "@intentius/chant/components";
import { parseYAML } from "@intentius/chant/yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chant build --components --generate forgejo — Loom component set", () => {
  test("the committed .forgejo/workflows/components.yml matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "forgejo", { env: "production" });
    expect(result.success).toBe(true);

    const committed = readFileSync(resolve(".forgejo/workflows/components.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  });
});
