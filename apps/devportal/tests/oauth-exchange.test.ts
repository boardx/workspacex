import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeCodeForUser } from "../lib/oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub OAuth token exchange classification (#450)", () => {
  beforeEach(() => {
    process.env["GITHUB_OAUTH_CLIENT_ID"] = "configured-client";
    process.env["GITHUB_OAUTH_CLIENT_SECRET"] = "configured-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GITHUB_OAUTH_CLIENT_ID"];
    delete process.env["GITHUB_OAUTH_CLIENT_SECRET"];
  });

  it("distinguishes a valid client with an invalid code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "bad_verification_code" })),
    );

    await expect(exchangeCodeForUser("invalid-code")).resolves.toEqual({
      ok: false,
      reason: "bad_verification_code",
    });
  });

  it("distinguishes incorrect client credentials from an invalid code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "incorrect_client_credentials" })),
    );

    await expect(exchangeCodeForUser("invalid-code")).resolves.toEqual({
      ok: false,
      reason: "incorrect_client_credentials",
    });
  });

  it("fails closed before GitHub when either client credential is missing", async () => {
    delete process.env["GITHUB_OAUTH_CLIENT_SECRET"];
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(exchangeCodeForUser("invalid-code")).resolves.toEqual({
      ok: false,
      reason: "client_credentials_missing",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves the successful token and user exchange path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "opaque-access-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ login: "octocat", name: "Octo Cat", email: null, avatar_url: null }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(exchangeCodeForUser("valid-code")).resolves.toEqual({
      ok: true,
      user: {
        login: "octocat",
        name: "Octo Cat",
        email: null,
        avatarUrl: null,
      },
    });
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer opaque-access-token",
    );
  });
});
