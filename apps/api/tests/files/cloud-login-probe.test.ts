import { expect, it, vi } from "vitest";
import { verifyCloudLogin } from "../../scripts/cloud-runtime-probes";
const input = { publicUrl: "https://workspace.example.com", email: "owner@example.com", password: "private-value",
  expectedDeploymentMarker: "fresh-attempt", signal: new AbortController().signal };
it("rejects a healthy old endpoint before sending the administrator password", async () => {
  const request = vi.fn(async () => Response.json({ trustworthy: true, deploymentMarker: "previous-attempt" }));
  await expect(verifyCloudLogin(input, request)).rejects.toThrow("CLOUD_LOGIN_PROBE_FAILED");
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.stringify(request.mock.calls)).not.toContain("private-value");
});
it("authenticates only after matching the current deployment marker", async () => {
  const request = vi.fn(async url => String(url).includes("/.well-known/") ? Response.json({ deploymentMarker: "fresh-attempt" }) : String(url).endsWith("/healthz")
    ? Response.json({ trustworthy: true, deploymentMarker: "fresh-attempt" })
    : Response.json({ sessionToken: "private-token", userId: "user", orgs: ["org"], expiresAt: "2026-09-12T00:00:00.000Z" }));
  expect((await verifyCloudLogin(input, request)).sessionToken).toBe("private-token");
  expect(request).toHaveBeenCalledTimes(3);
});
it("rejects an unexpected tenant without issuing its business requests", async () => {
  const request = vi.fn(async url => String(url).includes("/.well-known/") ? Response.json({ deploymentMarker: "fresh-attempt" }) : String(url).endsWith("/healthz")
    ? Response.json({ trustworthy: true, deploymentMarker: "fresh-attempt" })
    : Response.json({ sessionToken: "private-token", userId: "user", orgs: ["different-org"], expiresAt: "2026-09-12T00:00:00.000Z" }));
  await expect(verifyCloudLogin({ ...input, orgId: "expected-org" }, request)).rejects.toThrow("CLOUD_LOGIN_PROBE_FAILED");
  expect(request).toHaveBeenCalledTimes(3);
});

it("rejects a stale public API even when the public Web marker matches", async () => {
  const request = vi.fn(async url => String(url).includes("/.well-known/") ? Response.json({ deploymentMarker: "fresh-attempt" })
    : Response.json({ trustworthy: true, deploymentMarker: "old-api" }));
  await expect(verifyCloudLogin(input, request)).rejects.toThrow("CLOUD_LOGIN_PROBE_FAILED");
  expect(request).toHaveBeenCalledTimes(2);
});
