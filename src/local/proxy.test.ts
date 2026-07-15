import { describe, test, expect } from "vitest";
import { buildProxyRoutingConfig, loomLocalProxy } from "./proxy";

describe("loom local proxy (#48) — routing config", () => {
  test("mirrors Loom's ALB: /api/* and /health -> backend, / -> frontend", () => {
    const cfg = buildProxyRoutingConfig();
    expect(cfg).toContain("location /api/ { proxy_pass http://loom-backend:8000;");
    expect(cfg).toContain("location = /health { proxy_pass http://loom-backend:8000;");
    expect(cfg).toContain("location / { proxy_pass http://loom-frontend:8000;");
  });

  test("targets + port are parameterized", () => {
    const cfg = buildProxyRoutingConfig({ backendService: "be", frontendService: "fe", servicePort: 9000 });
    expect(cfg).toContain("proxy_pass http://be:9000");
    expect(cfg).toContain("proxy_pass http://fe:9000");
    expect(cfg).not.toContain("loom-backend");
  });

  test("preserves the host header (SPA + API on one origin)", () => {
    expect(buildProxyRoutingConfig()).toContain("proxy_set_header Host $host");
  });
});

describe("loom local proxy (#48) — Service", () => {
  test("publishes the listen port to the in-container nginx port", () => {
    const svc = loomLocalProxy({ listenPort: 8080 }) as any;
    expect(svc.props.image).toMatch(/nginx/);
    expect(svc.props.ports).toContain("8080:8080");
  });

  test("depends on both app services and joins the shared network", () => {
    const svc = loomLocalProxy() as any;
    expect(svc.props.depends_on).toEqual(["loom-backend", "loom-frontend"]);
    expect(svc.props.networks).toContain("loom-local");
  });

  test("bind-mounts the generated config read-only at nginx's config path", () => {
    const svc = loomLocalProxy({ configPath: "./nginx.local.conf" }) as any;
    expect(svc.props.volumes).toContain("./nginx.local.conf:/etc/nginx/nginx.conf:ro");
  });
});
