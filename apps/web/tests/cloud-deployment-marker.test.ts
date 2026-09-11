import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic, revalidate } from "../app/.well-known/workspacex-deployment/route";

afterEach(() => vi.unstubAllEnvs());
describe("public Web deployment identity", () => {
  it("fails closed when this deployment has no marker", async () => {
    vi.stubEnv("WORKSPACEX_DEPLOYMENT_MARKER", "");
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "DEPLOYMENT_MARKER_UNAVAILABLE" });
  });
  it("reads runtime identity on every request and disables caching", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
    for (const marker of ["deployment-one", "deployment-two"]) {
      vi.stubEnv("WORKSPACEX_DEPLOYMENT_MARKER", marker);
      const result = await GET();
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toContain("no-store");
      expect(await result.json()).toEqual({ deploymentMarker: marker });
    }
  });
});
