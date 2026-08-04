import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForUser: vi.fn(),
}));

vi.mock("@/lib/oauth", () => ({
  clearStateCookieHeader: () => "devportal_oauth_state=; Max-Age=0",
  exchangeCodeForUser: mocks.exchangeCodeForUser,
  STATE_COOKIE: "devportal_oauth_state",
  verifyState: vi.fn(async () => ({ nonce: "nonce-123", returnTo: "/me" })),
}));

vi.mock("@/lib/session", () => ({
  sessionCookieHeader: vi.fn(),
  signSession: vi.fn(),
}));

import { GET } from "../app/api/coord/oauth/github/callback/route";

function callbackRequest(): Request {
  return new Request(
    "https://devportal-4mx.pages.dev/api/coord/oauth/github/callback?code=invalid&state=nonce-123",
    { headers: { cookie: "devportal_oauth_state=signed-state" } },
  );
}

describe("OAuth callback failure classification (#450)", () => {
  beforeEach(() => mocks.exchangeCodeForUser.mockReset());

  it.each(["client_credentials_missing", "incorrect_client_credentials"])(
    "preserves credential failure reason: %s",
    async (reason) => {
      mocks.exchangeCodeForUser.mockResolvedValue({ ok: false, reason });

      const response = await GET(callbackRequest());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "oauth_failed", reason });
    },
  );

  it("preserves bad_verification_code as the only positive production probe outcome", async () => {
    mocks.exchangeCodeForUser.mockResolvedValue({ ok: false, reason: "bad_verification_code" });

    const response = await GET(callbackRequest());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "oauth_failed",
      reason: "bad_verification_code",
    });
  });
});
