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

    const result = await generateComponentsPipeline(".", "forgejo", { env: "production" });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const jobNames = new Set(result.jobs!.map((j) => j.jobName));
    const allComponents = graph.waves.flat();
    expect(jobNames.size).toBe(allComponents.length);
    for (const name of allComponents) expect(jobNames.has(name)).toBe(true);

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

  test("produces a Forgejo-dialect workflow (runs-on: docker, code.forgejo.org actions) with artifact threading", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    const result = await generateComponentsPipeline(".", "forgejo", { env: "production" });
    expect(result.success).toBe(true);

    const parsed = parseYAML(result.yaml!) as Record<string, any>;
    expect(parsed.on?.workflow_dispatch).toBeDefined();

    const jobKeys = Object.keys(parsed.jobs);
    const allComponents = graph.waves.flat();
    expect(new Set(jobKeys)).toEqual(new Set(allComponents));

    // Forgejo dialect markers.
    expect(result.yaml).toContain("runs-on: docker");
    expect(result.yaml).toContain("code.forgejo.org/actions/checkout");
    expect(result.yaml).toContain("code.forgejo.org/actions/upload-artifact");

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

    // shared-foundation dumps its outputs; loom-backend seeds its 3 upstreams.
    expect(runLine("shared-foundation")).toContain("--dump-outputs shared-foundation.outputs.json");
    const backendRun = runLine("loom-backend");
    expect(backendRun).toContain("--seed-outputs shared-foundation.outputs.json");
    expect(backendRun).toContain("--seed-outputs loom-db.outputs.json");
    expect(backendRun).toContain("--seed-outputs loom-cognito.outputs.json");

    for (const name of allComponents) {
      expect(runLine(name)).toContain(`chant run --components ${name}`);
    }
  });

  test("the committed .forgejo/workflows/components.yml matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "forgejo", { env: "production" });
    expect(result.success).toBe(true);

    const committed = readFileSync(resolve(".forgejo/workflows/components.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  });
});
