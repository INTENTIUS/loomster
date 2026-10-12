/**
 * The deployed web app signs in (loomster#75): loom-frontend's image build
 * takes loom-cognito's user client id as `VITE_COGNITO_USER_CLIENT_ID`, the
 * one value Loom's SPA needs baked in (it reads the pool id and region from
 * the backend). Checks the component wiring and that chant's step resolver
 * turns the reference into the deployed id.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { resolveStepInput } from "@intentius/chant/components";

const ENV_KEYS = ["LOOM_COGNITO_MODE", "LOOM_COGNITO_USER_CLIENT_ID"] as const;

async function loadComponent(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  const { loomFrontend } = await import("./loom-frontend.component");
  return loomFrontend;
}

function dockerBuildSteps(component: Awaited<ReturnType<typeof loadComponent>>) {
  const steps = component.deploy.flatMap((p) => p.steps) as Array<Record<string, unknown>>;
  return [component.build as Record<string, unknown>, ...steps.filter((s) => s.kind === "docker-build")];
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
});

// Each test re-imports the component under a fresh module graph, which is slow
// when the whole suite runs in parallel.
describe("loom-frontend: the image carries the Cognito user client id (loomster#75)", { timeout: 60_000 }, () => {
  test("provision (default): depends on loom-cognito, and every docker-build passes oUserClientId", async () => {
    const component = await loadComponent({});
    expect(component.dependsOn).toEqual(expect.arrayContaining(["shared-foundation", "loom-cognito"]));
    const builds = dockerBuildSteps(component);
    expect(builds).toHaveLength(2);
    for (const b of builds) {
      expect(b.buildArgs).toEqual({ VITE_COGNITO_USER_CLIENT_ID: { stackOutput: { stack: "loom-cognito", name: "oUserClientId" } } });
    }
  });

  test("the build arg resolves to the deployed client id from loom-cognito's outputs", async () => {
    const component = await loadComponent({});
    const build = dockerBuildSteps(component)[1];
    const resolved = resolveStepInput(build, {}, { "loom-cognito": { oUserClientId: "4abc123clientid" } });
    expect(resolved.buildArgs).toEqual({ VITE_COGNITO_USER_CLIENT_ID: "4abc123clientid" });
  });

  test("reference-existing with a user client id passes it; without one, no build args", async () => {
    const withClient = await loadComponent({ LOOM_COGNITO_MODE: "reference-existing", LOOM_COGNITO_USER_CLIENT_ID: "shared-client" });
    expect(dockerBuildSteps(withClient)[1].buildArgs).toBeDefined();
    const withoutClient = await loadComponent({ LOOM_COGNITO_MODE: "reference-existing" });
    expect(dockerBuildSteps(withoutClient)[1].buildArgs).toBeUndefined();
  });

  test("omit: no user client, so no build args (the image keeps Loom's empty default)", async () => {
    const component = await loadComponent({ LOOM_COGNITO_MODE: "omit" });
    for (const b of dockerBuildSteps(component)) expect(b.buildArgs).toBeUndefined();
  });
});
