import { describe, test, expect } from "vitest";
import { resolveRoute53, resolveAcm } from "./params";

// DNS seam resolution for the deployable (#117). The composite already supports
// route53/acm reference-existing + omit; these cover the params-layer decision
// that wires them from LOOM_HOSTED_ZONE_ID / LOOM_CERTIFICATE_ARN / LOOM_ROUTE53
// / LOOM_ACM, which previously wasn't threaded through at all (always provision).

describe("resolveRoute53", () => {
  test("LOOM_HOSTED_ZONE_ID references an existing zone (the common adoption case)", () => {
    expect(resolveRoute53("Z0123456789ABCDEFGHIJ", undefined)).toEqual({
      mode: "reference-existing",
      hostedZoneId: "Z0123456789ABCDEFGHIJ",
    });
  });

  test("a hosted zone id wins over any LOOM_ROUTE53 mode", () => {
    expect(resolveRoute53("Zabc", "omit")).toEqual({ mode: "reference-existing", hostedZoneId: "Zabc" });
  });

  test("LOOM_ROUTE53=omit drops DNS", () => {
    expect(resolveRoute53(undefined, "omit")).toEqual({ mode: "omit" });
  });

  test("LOOM_ROUTE53=provision forces a new zone", () => {
    expect(resolveRoute53(undefined, "provision")).toEqual({ mode: "provision" });
  });

  test("unset leaves the composite's tier default (undefined)", () => {
    expect(resolveRoute53(undefined, undefined)).toBeUndefined();
    expect(resolveRoute53(undefined, "garbage")).toBeUndefined();
  });
});

describe("resolveAcm", () => {
  test("LOOM_CERTIFICATE_ARN references an existing, already-validated cert", () => {
    const arn = "arn:aws:acm:us-east-1:000000000000:certificate/abc";
    expect(resolveAcm(arn, undefined)).toEqual({ mode: "reference-existing", certificateArn: arn });
  });

  test("a certificate arn wins over any LOOM_ACM mode", () => {
    expect(resolveAcm("arn:x", "omit")).toEqual({ mode: "reference-existing", certificateArn: "arn:x" });
  });

  test("LOOM_ACM=omit drops HTTPS; provision forces a new cert; unset -> default", () => {
    expect(resolveAcm(undefined, "omit")).toEqual({ mode: "omit" });
    expect(resolveAcm(undefined, "provision")).toEqual({ mode: "provision" });
    expect(resolveAcm(undefined, undefined)).toBeUndefined();
  });
});
