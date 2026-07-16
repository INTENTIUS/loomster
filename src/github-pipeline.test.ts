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
  test("discovers the full Loom component set with the expected dependsOn graph", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    expect(graph.waves.length).toBe(4);
    expect(new Set(graph.waves[0])).toEqual(new Set(["shared-foundation", "loom-cognito"]));
    expect(new Set(graph.waves[1])).toEqual(new Set(["loom-db", "loom-frontend", "downstream-stub"]));
    expect(graph.waves[2]).toEqual(["loom-backend"]);
    expect(graph.waves[3]).toEqual(["loom-agents"]);
  });

  test("generates a workflow whose jobs/needs match the component dependsOn graph exactly", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    const result = await generateComponentsPipeline(".", "github", { env: "production" });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // One job per discovered component — none dropped, none invented.
    const jobNames = new Set(result.jobs!.map((j) => j.jobName));
    const allComponents = graph.waves.flat();
    expect(jobNames.size).toBe(allComponents.length);
    for (const name of allComponents) expect(jobNames.has(name)).toBe(true);

    // needs: mirrors dependsOn exactly (sorted), for every component.
    const dependsOnByName = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = dependsOnByName.get(edge.from) ?? [];
      list.push(edge.to);
      dependsOnByName.set(edge.from, list);
    }
    for (const job of result.jobs!) {
      const expectedNeeds = (dependsOnByName.get(job.component) ?? []).slice().sort();
      expect(job.needs.slice().sort()).toEqual(expectedNeeds);
    }
  });

  test("produces a workflow_dispatch workflow with artifact threading across needs: edges", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    const result = await generateComponentsPipeline(".", "github", { env: "production" });
    expect(result.success).toBe(true);

    const parsed = parseYAML(result.yaml!) as Record<string, any>;

    // Manual trigger, no stages section (GitHub has none).
    expect(parsed.on?.workflow_dispatch).toBeDefined();
    expect(parsed.stages).toBeUndefined();

    // One job per component under jobs:.
    const jobKeys = Object.keys(parsed.jobs);
    const allComponents = graph.waves.flat();
    expect(new Set(jobKeys)).toEqual(new Set(allComponents));

    // needs: on each job mirrors dependsOn (wave-1 components have no needs key).
    const dependsOnByName = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = dependsOnByName.get(edge.from) ?? [];
      list.push(edge.to);
      dependsOnByName.set(edge.from, list);
    }
    for (const name of allComponents) {
      const expectedNeeds = (dependsOnByName.get(name) ?? []).slice().sort();
      const actualNeeds = ((parsed.jobs[name].needs as string[]) ?? []).slice().sort();
      expect(actualNeeds).toEqual(expectedNeeds);
    }

    const runLine = (name: string): string => {
      const steps = parsed.jobs[name].steps as Array<Record<string, any>>;
      const runSteps = steps.filter((s) => typeof s.run === "string" && s.run.startsWith("chant run --components"));
      expect(runSteps.length).toBe(1);
      return runSteps[0].run as string;
    };
    const hasUploadArtifact = (name: string): boolean =>
      (parsed.jobs[name].steps as Array<Record<string, any>>).some((s) => typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact"));

    // shared-foundation is depended on by 4 components — it dumps + uploads its outputs.
    expect(runLine("shared-foundation")).toContain("--dump-outputs shared-foundation.outputs.json");
    expect(hasUploadArtifact("shared-foundation")).toBe(true);

    // loom-backend consumes 3 upstream components' outputs and triggers exactly itself.
    const backendRun = runLine("loom-backend");
    expect(backendRun).toContain("--seed-outputs shared-foundation.outputs.json");
    expect(backendRun).toContain("--seed-outputs loom-db.outputs.json");
    expect(backendRun).toContain("--seed-outputs loom-cognito.outputs.json");

    // Every job is a single thin trigger invocation — never inlined deploy steps.
    for (const name of allComponents) {
      expect(runLine(name)).toContain(`chant run --components ${name}`);
    }
  });

  test("the committed .github/workflows/components.yml matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "github", { env: "production" });
    expect(result.success).toBe(true);

    const committed = readFileSync(resolve(".github/workflows/components.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  });
});
