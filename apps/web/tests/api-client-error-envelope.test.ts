import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API error envelope", () => {
  it("reads reasonCode from the signed top-level error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "unauthorized",
      reasonCode: "INVALID_CREDENTIAL",
      traceId: "trace-login",
    }), { status: 401, headers: { "content-type": "application/json" } })));

    const error = await apiRequest("/auth/login", {
      method: "POST",
      body: { email: "lead@example.com", password: "wrong" },
      sessionToken: null,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, reasonCode: "INVALID_CREDENTIAL" });
  });

  it("does not invent a reasonCode when the envelope omits it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "service_unavailable",
      traceId: "trace-dependency",
    }), { status: 503, headers: { "content-type": "application/json" } })));

    const error = await apiRequest("/identity/me").catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 503, reasonCode: null });
  });
});


describe("optional expected success status", () => {
  it.each([200, 202])("rejects HTTP %s when creation requires 201, without a second request", async (status) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ feedbackId: "real-id", status: "待处理" }), { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(apiRequest("/feedback", { method: "POST", expectedStatus: 201, sessionToken: null })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("accepts the actual 201 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ feedbackId: "real-id" }), { status: 201 })));
    await expect(apiRequest("/feedback", { method: "POST", expectedStatus: 201, sessionToken: null })).resolves.toEqual({ feedbackId: "real-id" });
  });
});
