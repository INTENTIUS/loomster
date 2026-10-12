import { describe, expect, test } from "vitest";
import { buildProxyRoutingConfig, loomLocalProxy, loopbackPublishedPort } from "./proxy";

// Loom v1.8.1+ honours LOOM_ALLOW_UNAUTHENTICATED_LOCAL_DEV only for loopback
// clients with no forwarding headers (loomster#3). These pin the proxy shape
// that makes the local run satisfy that.
describe("local proxy, loopback mode", () => {
  const opts = { backendService: "loomBackend", frontendService: "loomFrontend", backendOverLoopback: true };

  test("proxies the API to the backend over 127.0.0.1", () => {
    const conf = buildProxyRoutingConfig(opts);
    expect(conf).toContain("location /api/ { proxy_pass http://127.0.0.1:8000;");
    expect(conf).toContain("location = /health { proxy_pass http://127.0.0.1:8000;");
    expect(conf).toContain("location / { proxy_pass http://loomFrontend:8000;");
  });

  test("clears every header Loom treats as proxy forwarding", () => {
    const conf = buildProxyRoutingConfig(opts);
    for (const h of ["X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", "Forwarded"]) {
      expect(conf).toContain(`proxy_set_header ${h} "";`);
    }
  });

  test("joins the backend's network namespace with no ports of its own", () => {
    const props = (loomLocalProxy(opts) as unknown as { props: Record<string, unknown> }).props;
    expect(props.network_mode).toBe("service:loomBackend");
    expect(props.ports).toBeUndefined();
    expect(props.networks).toBeUndefined();
  });

  test("the published port binds the host's loopback only", () => {
    expect(loopbackPublishedPort(8080)).toBe("127.0.0.1:8080:8080");
  });
});
