import { describe, expect, it, vi } from "vitest";
import { probeWebLoginPage } from "../../scripts/cloud-service-readiness-web";

const marker = '<form data-testid="login-form">';

describe("cloud Web readiness follows only the intentional login boundary", () => {
  it("accepts the root's same-origin /login redirect and verifies the login marker", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/login" } }))
      .mockResolvedValueOnce(new Response(marker, { status: 200, headers: { "content-type": "text/html" } }));

    await expect(probeWebLoginPage(fetch)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenNthCalledWith(1, "http://web:3000/", expect.objectContaining({ redirect: "manual" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://web:3000/login", expect.objectContaining({ redirect: "error" }));
  });

  it("accepts a directly rendered login page at the Web root", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(marker, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    }));
    await expect(probeWebLoginPage(fetch)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an external redirect without sending a request to that origin", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 307, headers: { location: "https://evil.example/login" },
    }));
    await expect(probeWebLoginPage(fetch)).rejects.toThrow("WEB_LOGIN_REDIRECT_INVALID");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects Web 5xx and never treats a responding process as ready", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(probeWebLoginPage(fetch)).rejects.toThrow("WEB_LOGIN_RESPONSE_INVALID");
  });

  it("rejects a failed login page after an otherwise valid redirect", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/login" } }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(probeWebLoginPage(fetch)).rejects.toThrow("WEB_LOGIN_RESPONSE_INVALID");
  });

  it("rejects an unexpected same-origin redirect and a marker-free 200", async () => {
    const wrongPath = vi.fn().mockResolvedValue(new Response(null, {
      status: 307, headers: { location: "/projects" },
    }));
    await expect(probeWebLoginPage(wrongPath)).rejects.toThrow("WEB_LOGIN_REDIRECT_INVALID");

    const noMarker = vi.fn().mockResolvedValue(new Response("<html></html>", {
      status: 200, headers: { "content-type": "text/html" },
    }));
    await expect(probeWebLoginPage(noMarker)).rejects.toThrow("WEB_LOGIN_MARKER_MISSING");
  });
});
