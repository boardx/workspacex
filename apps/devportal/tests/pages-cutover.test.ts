import { describe, expect, it, vi } from "vitest";

import {
  runPagesCutover,
  smokeProduction,
} from "../scripts/pages-cutover.mjs";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "secret-token",
  CF_ACCESS_TEAM_DOMAIN: "https://boardx.cloudflareaccess.com",
  GITHUB_SHA: "0123456789abcdef",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DevPortal production cutover (#450)", () => {
  it("fails closed before publish when there is no known-good production deployment", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, result: [{ id: "preview", environment: "preview" }] }),
    );
    const deploy = vi.fn();

    await expect(runPagesCutover({ env, fetchImpl, deploy })).rejects.toThrow(
      "known-good production deployment",
    );
    expect(deploy).not.toHaveBeenCalled();
  });

  it("keeps the new deployment when every production smoke passes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        result: [
          {
            id: "previous-good",
            environment: "production",
            latest_stage: { status: "success" },
          },
        ],
      }),
    );
    const deploy = vi.fn(async () => undefined);
    const smoke = vi.fn(async () => undefined);

    await expect(
      runPagesCutover({ env, fetchImpl, deploy, smoke, logger: { info: vi.fn(), error: vi.fn() } }),
    ).resolves.toBeUndefined();
    expect(deploy).toHaveBeenCalledOnce();
    expect(smoke).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rolls back to the captured known-good deployment when production smoke fails", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (method === "POST") {
        return jsonResponse({ success: true, result: { id: "previous-good" } });
      }
      return jsonResponse({
        success: true,
        result: [
          {
            id: "previous-good",
            environment: "production",
            latest_stage: { status: "success" },
          },
        ],
      });
    });
    const deploy = vi.fn(async () => undefined);
    const smoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("new release unhealthy"))
      .mockResolvedValueOnce(undefined);

    await expect(runPagesCutover({ env, fetchImpl, deploy, smoke })).rejects.toThrow(
      "rolled back",
    );
    expect(deploy).toHaveBeenCalledOnce();
    expect(smoke).toHaveBeenCalledTimes(2);
    expect(requests).toContainEqual({
      url: expect.stringContaining("/deployments/previous-good/rollback"),
      method: "POST",
    });
  });

  it("surfaces rollback failure and never reports a failed release as healthy", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ success: false, errors: [{ code: 9000 }] }, 500);
      }
      return jsonResponse({
        success: true,
        result: [
          {
            id: "previous-good",
            environment: "production",
            latest_stage: { status: "success" },
          },
        ],
      });
    });

    await expect(
      runPagesCutover({
        env,
        fetchImpl,
        deploy: async () => undefined,
        smoke: async () => {
          throw new Error("unhealthy");
        },
      }),
    ).rejects.toThrow("rollback failed");
  });

  it.each([
    "https://access.example/cdn-cgi/access/login/develop.boardx.us",
    "https://boardx.cloudflareaccess.com/cdn-cgi/access/login/other.example",
  ])("rejects an arbitrary 302 outside the configured Access application: %s", async (location) => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location } }),
    );

    await expect(
      smokeProduction({
        fetchImpl,
        accessTeamDomain: "https://boardx.cloudflareaccess.com",
      }),
    ).rejects.toThrow("Cloudflare Access");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["incorrect_client_credentials", "client_credentials_missing"])(
    "rejects OAuth callback credential failure: %s",
    async (reason) => {
      const stateCookie = "devportal_oauth_state=signed-state; Path=/api/coord/oauth";
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === "develop.boardx.us") {
          return new Response(null, {
            status: 302,
            headers: {
              location:
                "https://boardx.cloudflareaccess.com/cdn-cgi/access/login/develop.boardx.us",
            },
          });
        }
        if (url.pathname === "/api/portal/pulse") {
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        if (url.pathname.endsWith("/login")) {
          return new Response(null, {
            status: 302,
            headers: {
              location:
                "https://github.com/login/oauth/authorize?client_id=configured-client&state=nonce-123",
              "set-cookie": stateCookie,
            },
          });
        }
        if (url.pathname.endsWith("/callback")) {
          return jsonResponse({ error: "oauth_failed", reason }, 401);
        }
        throw new Error(`unexpected smoke URL: ${url}`);
      });

      await expect(
        smokeProduction({
          fetchImpl,
          accessTeamDomain: "https://boardx.cloudflareaccess.com",
        }),
      ).rejects.toThrow("bad_verification_code");
    },
  );

  it("exercises configured Access, protected API, OAuth login state, and classified callback", async () => {
    const stateCookie = "devportal_oauth_state=signed-state; Path=/api/coord/oauth";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "develop.boardx.us") {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://boardx.cloudflareaccess.com/cdn-cgi/access/login/develop.boardx.us",
          },
        });
      }
      if (url.pathname === "/api/portal/pulse") {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (url.pathname.endsWith("/login")) {
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.searchParams.set("client_id", "configured-client");
        authorize.searchParams.set("state", "nonce-123");
        return new Response(null, {
          status: 302,
          headers: { location: authorize.toString(), "set-cookie": stateCookie },
        });
      }
      if (url.pathname.endsWith("/callback")) {
        expect(url.searchParams.get("state")).toBe("nonce-123");
        expect(new Headers(init?.headers).get("cookie")).toBe(
          "devportal_oauth_state=signed-state",
        );
        return jsonResponse({ error: "oauth_failed", reason: "bad_verification_code" }, 401);
      }
      throw new Error(`unexpected smoke URL: ${url}`);
    });

    await expect(
      smokeProduction({
        fetchImpl,
        accessTeamDomain: "https://boardx.cloudflareaccess.com",
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
