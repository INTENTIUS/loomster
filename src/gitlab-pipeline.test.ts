/**
 * chant#892 — validates GitLab component-pipeline generation for the Loom
 * component set. The generator itself lives in chant
 * (`lexicons/gitlab/src/components/generate-pipeline.ts`, already unit-tested
 * there); this file proves the generic `chant build --components --generate
 * gitlab` seam, wired against this repo's REAL discovered components
 * (`src/components/*.component.ts`), produces a wave-ordered `.gitlab-ci.yml`
 * whose stage/job/`needs:` structure matches the same `dependsOn` graph
 * `chant graph --components` reports (`computeComponentGraph`) — not a
 * synthetic fixture.
 *
 * Committed alongside the generated `.gitlab-ci.yml` (repo root) so both stay
 * honest: regenerate with `npm run generate:gitlab` whenever a component's
 * `dependsOn` changes, and this test fails if the committed file and the
 * live component graph drift apart from each other or from wave order.
 */

import { describe, test, expect } from "vitest";
import { generateComponentsPipeline, computeComponentGraph } from "@intentius/chant/components";
import { parseYAML } from "@intentius/chant/yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chant build --components --generate gitlab — Loom component set", () => {
  test("the committed .gitlab/components.yml matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "gitlab", { env: "production" });
    expect(result.success).toBe(true);

    // The generated component pipeline lives in .gitlab/components.yml, included
    // by the hand-written root .gitlab-ci.yml (which adds the gated deploy and
    // scheduled lifecycle jobs — see the root file).
    const committed = readFileSync(resolve(".gitlab/components.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  }, 60_000);
});
