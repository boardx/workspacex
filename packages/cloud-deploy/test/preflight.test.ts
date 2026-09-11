import { expect, it, vi } from "vitest";
import { deploymentExample } from "../src/examples";
import { requireComposeVersion, verifyEcsIdentity, verifyHttpsEndpoint } from "../src/preflight";
const context = () => ({ signal: new AbortController().signal, remainingMs: () => 1000 });
function metadataResponse() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("api/token")) { expect(init?.method).toBe("PUT"); return new Response("private-token"); }
    expect((init?.headers as Record<string, string>)["X-aliyun-ecs-metadata-token"]).toBe("private-token");
    if (url.endsWith("instance-id")) return new Response("i-example");
    if (url.endsWith("region-id")) return new Response("cn-hangzhou");
    return new Response("workspacex-runtime\n");
  });
}
it("binds the target instance, region and RAM role using only IMDSv2", async () => {
  const request = metadataResponse();
  expect(await verifyEcsIdentity(deploymentExample("starter"), context(), request)).toEqual({ instanceMatched: true, regionMatched: true, roleMatched: true });
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.every(([url]) => String(url).startsWith("http://100.100.100.200/latest/"))).toBe(true);
});
it("refuses target drift and never leaks metadata token or raw errors", async () => {
  const config = deploymentExample("production"); config.environment.ecsInstanceId = "i-wrong";
  await expect(verifyEcsIdentity(config, context(), metadataResponse())).rejects.toThrow(/^ECS_IDENTITY_PREFLIGHT_FAILED$/);
  const denied = vi.fn<typeof fetch>(async () => new Response("private-token", { status: 403 }));
  await expect(verifyEcsIdentity(config, context(), denied)).rejects.toThrow(/^ECS_IDENTITY_PREFLIGHT_FAILED$/);
  expect(denied).toHaveBeenCalledTimes(1);
});
it("bounds metadata output and refuses expired budgets", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("x".repeat(5000)));
  await expect(verifyEcsIdentity(deploymentExample("starter"), context(), request)).rejects.toThrow("ECS_IDENTITY_PREFLIGHT_FAILED");
  request.mockClear();
  await expect(verifyEcsIdentity(deploymentExample("starter"), { ...context(), remainingMs: () => 0 }, request)).rejects.toThrow("ECS_IDENTITY_PREFLIGHT_FAILED");
  expect(request).not.toHaveBeenCalled();
});
it("HTTPS preflight checks transport without misrepresenting application readiness", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
  await verifyHttpsEndpoint("https://workspace.example.com", context(), request);
  expect(request.mock.calls[0]?.[1]?.method).toBe("HEAD");
  expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
  await expect(verifyHttpsEndpoint("http://workspace.example.com", context(), request)).rejects.toThrow("HTTPS_PREFLIGHT_FAILED");
});
it("rejects reverse-proxy errors and unsupported Compose versions", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
  await expect(verifyHttpsEndpoint("https://workspace.example.com", context(), request)).rejects.toThrow("HTTPS_PREFLIGHT_FAILED");
  for (const version of ["2.29.9", "1.29.2", "garbage"]) expect(() => requireComposeVersion(version)).toThrow("COMPOSE_2_30_REQUIRED");
  for (const version of ["v2.30.0", "2.40.1", "3.0.0"]) expect(() => requireComposeVersion(version)).not.toThrow();
});
