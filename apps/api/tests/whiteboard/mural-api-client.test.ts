import { describe, expect, it, vi } from "vitest";
import { MuralApiClient } from "../../src/infrastructure/whiteboard/mural-api-client";
const config = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://workspacex.test/studio/board/mural/callback",
  appPublicUrl: "https://workspacex.test",
};
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
describe("Mural API client", () => {
  it("uses only the fixed Mural v1 origin, exact read scopes, active murals and opaque next tokens", async () => {
    const http = vi.fn(async (url: URL, _init?: RequestInit) =>
      url.pathname.endsWith("/workspaces")
        ? json({ value: [{ id: "w", name: "Workspace" }], next: "w-next" })
        : json({
            value: [
              {
                id: "m",
                title: "Mural",
                updatedAt: "2026-09-24T00:00:00.000Z",
              },
            ],
            next: "m-next",
          }),
    );
    const client = new MuralApiClient(config, http as typeof fetch);
    const auth = new URL(client.authorizationUrl("state"));
    expect(auth.origin + auth.pathname).toBe(
      "https://app.mural.co/api/public/v1/authorization/oauth2/",
    );
    expect(auth.searchParams.get("scope")).toBe("workspaces:read murals:read");
    expect(auth.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect((await client.workspaces("access", undefined, 50)).next).toBe(
      "w-next",
    );
    await client.murals("access", "w", "opaque", 50);
    const called = new URL(String(http.mock.calls[1]![0]));
    expect(called.origin + called.pathname).toBe(
      "https://app.mural.co/api/public/v1/workspaces/w/murals",
    );
    expect(called.searchParams.get("status")).toBe("active");
    expect(called.searchParams.get("next")).toBe("opaque");
    expect(http.mock.calls[1]![1]).toMatchObject({ redirect: "error" });
  });
  it("parses authorization-code and refresh JSON even when Mural omits scope", async () => {
    const requests: RequestInit[] = [];
    const http = vi.fn(async (_url: URL, init: RequestInit) => {
      requests.push(init);
      return json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 900,
      });
    });
    const client = new MuralApiClient(
      config,
      http as typeof fetch,
      async () => {},
    );
    await expect(client.exchange("code")).resolves.toMatchObject({
      credential: { access: "access", refresh: "refresh" },
      scopes: ["workspaces:read", "murals:read"],
    });
    await expect(client.refresh("refresh")).resolves.toMatchObject({
      credential: { access: "access" },
    });
    expect(String(requests[0]!.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(requests[1]!.body)).toContain("grant_type=refresh_token");
  });
  it("rejects narrowed returned scopes and bounds HTTP-date retry-after", async () => {
    const sleeps: number[] = [];
    const limited = json({}, 429, { "retry-after": "Wed, 24 Sep 2026 00:00:20 GMT" });
    const cancel = vi.spyOn(limited.body!, "cancel");
    const http = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(json({ value: [] }));
    const client = new MuralApiClient(
      config,
      http as typeof fetch,
      async (ms) => {
        sleeps.push(ms);
      },
      10000,
      () => Date.parse("2026-09-24T00:00:00Z"),
    );
    await client.workspaces("access", undefined, 50);
    expect(sleeps).toEqual([10000]);
    expect(cancel).toHaveBeenCalledTimes(1);
    const narrowed = new MuralApiClient(
      config,
      vi.fn(async () =>
        json({ access_token: "a", scope: "murals:read" }),
      ) as typeof fetch,
    );
    await expect(narrowed.exchange("code")).rejects.toMatchObject({
      code: "OAUTH_SCOPE_INSUFFICIENT",
    });
  });
  it("fetches mural detail and widget pages through value/next", async () => {
    const http = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/widgets")
        ? json({ value: [{ id: "x", type: "sticky" }], next: null })
        : json({ value: { id: "m", title: "Planning" } }),
    );
    const client = new MuralApiClient(config, http as typeof fetch);
    await expect(client.mural("a", "m")).resolves.toEqual({
      id: "m",
      name: "Planning",
    });
    await expect(client.widgets("a", "m")).resolves.toEqual({
      data: [{ id: "x", type: "sticky" }],
      next: null,
    });
  });
  it.each([
    "http://workspacex.test/studio/board/mural/callback",
    "https://evil.test/studio/board/mural/callback",
    "https://workspacex.test/whiteboards/mural/oauth/callback",
    "https://workspacex.test/studio/board/mural/callback?next=https://evil.test",
    "https://workspacex.test/studio/board/mural/callback#code",
    "https://user@workspacex.test/studio/board/mural/callback",
  ])(
    "rejects a redirect URI outside the exact WorkspaceX Web callback: %s",
    (redirectUri) => {
      expect(() => new MuralApiClient({ ...config, redirectUri })).toThrow(
        "MURAL_OAUTH_CONFIG_INVALID",
      );
    },
  );
  it.each([
    "http://workspacex.test",
    "https://workspacex.test/base",
    "https://workspacex.test?tenant=other",
    "https://user@workspacex.test",
  ])("rejects an invalid WorkspaceX public origin: %s", (appPublicUrl) => {
    expect(() => new MuralApiClient({ ...config, appPublicUrl })).toThrow(
      "MURAL_OAUTH_CONFIG_INVALID",
    );
  });
});
