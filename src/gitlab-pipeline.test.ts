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
  test("discovers the full Loom component set with the expected dependsOn graph", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    // The dependency spine the epic describes: shared-foundation and
    // loom-cognito have no deps; loom-db/loom-frontend/downstream-stub only
    // depend on shared-foundation; loom-backend is the 3-wide consumer that
    // closes wave 3; loom-agents (chant#893) then depends on loom-backend
    // (plus shared-foundation + loom-cognito), so it lands alone in wave 4.
    expect(graph.waves.length).toBe(4);
    expect(new Set(graph.waves[0])).toEqual(new Set(["shared-foundation", "loom-cognito"]));
    expect(new Set(graph.waves[1])).toEqual(new Set(["loom-db", "loom-frontend", "downstream-stub"]));
    expect(graph.waves[2]).toEqual(["loom-backend"]);
    expect(graph.waves[3]).toEqual(["loom-agents"]);

    const edgeSet = new Set(graph.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has("loom-db->shared-foundation")).toBe(true);
    expect(edgeSet.has("loom-frontend->shared-foundation")).toBe(true);
    expect(edgeSet.has("downstream-stub->shared-foundation")).toBe(true);
    expect(edgeSet.has("loom-backend->shared-foundation")).toBe(true);
    expect(edgeSet.has("loom-backend->loom-db")).toBe(true);
    expect(edgeSet.has("loom-backend->loom-cognito")).toBe(true);
    expect(edgeSet.has("loom-agents->shared-foundation")).toBe(true);
    expect(edgeSet.has("loom-agents->loom-cognito")).toBe(true);
    expect(edgeSet.has("loom-agents->loom-backend")).toBe(true);
  });

  test("generates a pipeline whose stages/jobs/needs match the component dependsOn graph exactly", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    const result = await generateComponentsPipeline(".", "gitlab", { env: "production" });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // One stage per parallel-safe wave, in wave order.
    expect(result.stages).toEqual(graph.waves.map((_, i) => `wave-${i + 1}`));

    // One job per discovered component — none dropped, none invented.
    const jobNames = new Set(result.jobs!.map((j) => j.jobName));
    const allComponents = graph.waves.flat();
    expect(jobNames.size).toBe(allComponents.length);
    for (const name of allComponents) expect(jobNames.has(name)).toBe(true);

    // Every job's stage matches the wave its component was resolved into
    // (component names here are already kebab-case, so jobName === component).
    graph.waves.forEach((wave, waveIndex) => {
      const expectedStage = `wave-${waveIndex + 1}`;
      for (const name of wave) {
        const job = result.jobs!.find((j) => j.component === name);
        expect(job).toBeDefined();
        expect(job!.stage).toBe(expectedStage);
      }
    });

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

  test("produces structurally valid YAML with output-artifact threading across needs: edges", async () => {
    const graph = await computeComponentGraph(".");
    expect(graph.success).toBe(true);

    const result = await generateComponentsPipeline(".", "gitlab", { env: "production" });
    expect(result.success).toBe(true);

    const parsed = parseYAML(result.yaml!);
    // Derive the expected stage list from the live wave graph, so it tracks
    // the real component set (4 waves once loom-agents is in, chant#893)
    // rather than a hardcoded count.
    expect(parsed.stages).toEqual(graph.waves.map((_, i) => `wave-${i + 1}`));

    // shared-foundation is depended on by 4 components — it must dump its
    // outputs as a job artifact for downstream jobs to seed from.
    const foundation = parsed["shared-foundation"] as Record<string, unknown>;
    expect((foundation.script as string[]).join(" ")).toContain("--dump-outputs shared-foundation.outputs.json");
    expect(foundation.artifacts).toEqual({ paths: ["shared-foundation.outputs.json"] });

    // loom-backend consumes 3 upstream components' outputs.
    const backend = parsed["loom-backend"] as Record<string, unknown>;
    const backendScript = (backend.script as string[]).join(" ");
    expect(backendScript).toContain("--seed-outputs shared-foundation.outputs.json");
    expect(backendScript).toContain("--seed-outputs loom-db.outputs.json");
    expect(backendScript).toContain("--seed-outputs loom-cognito.outputs.json");
    expect(backend.needs).toEqual(["loom-cognito", "loom-db", "shared-foundation"]);

    // Every job is a single thin trigger invocation — never inlined deploy steps.
    for (const job of result.jobs!) {
      const props = parsed[job.jobName] as Record<string, unknown>;
      const script = props.script as string[];
      const triggerLines = script.filter((line) => line.startsWith("chant run --components"));
      expect(triggerLines.length).toBe(1);
      expect(triggerLines[0]).toContain(`chant run --components ${job.component}`);
    }
  });

  test("the committed .gitlab-ci.yml at the repo root matches a fresh generate (no drift)", async () => {
    const result = await generateComponentsPipeline(".", "gitlab", { env: "production" });
    expect(result.success).toBe(true);

    const committed = readFileSync(resolve(".gitlab-ci.yml"), "utf-8");
    expect(committed).toBe(result.yaml);
  });
});
