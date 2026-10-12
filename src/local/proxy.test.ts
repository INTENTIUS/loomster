import { describe, expect, test } from "vitest";
import { buildProxyRoutingConfig, loomLocalProxy, localPublishedPort } from "./proxy";

// The local proxy mirrors Loom's ALB and, since loomster#58 (real Cognito login
// against Floci), runs in its own container on the shared network.
describe("local proxy", () => {
  const opts = { backendService: "loomBackend", frontendService: "loomFrontend", network: "loomNet" };

  test("routes /api and /health to the backend by service name, the rest to the SPA", () => {
    const conf = buildProxyRoutingConfig(opts);
    expect(conf).toContain("location /api/ { proxy_pass http://loomBackend:8000;");
    expect(conf).toContain("location = /health { proxy_pass http://loomBackend:8000;");
    expect(conf).toContain("location / { proxy_pass http://loomFrontend:8000;");
    expect(conf).not.toContain("127.0.0.1");
  });

  test("injects extra locations before the SPA catch-all", () => {
    const conf = buildProxyRoutingConfig({ ...opts, extraLocations: ["location /x/ { return 204; }"] });
    expect(conf.indexOf("location /x/")).toBeGreaterThan(-1);
    expect(conf.indexOf("location /x/")).toBeLessThan(conf.indexOf("location / {"));
  });

  test("joins the shared network and publishes on the host's loopback only", () => {
    const props = (loomLocalProxy(opts) as unknown as { props: Record<string, unknown> }).props;
    expect(props.network_mode).toBeUndefined();
    expect(props.networks).toEqual(["loomNet"]);
    expect(props.ports).toEqual(["127.0.0.1:8080:8080"]);
    expect(localPublishedPort(9090)).toBe("127.0.0.1:9090:8080");
  });
});
