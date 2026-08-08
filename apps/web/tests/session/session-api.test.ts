import { afterEach, describe, expect, it, vi } from "vitest";
import { switchCurrentOrganization } from "@/lib/session-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed current-org flow", () => {
  it("uses /auth/switch-org, then resolves the new identity without inventing an endpoint", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      calls.push({ url, init });
      if (url.pathname === "/auth/switch-org") {
        return new Response(JSON.stringify({
          org: { id: "org-two", name: "Two", kind: "organization", team: null },
        }), { status: 200 });
      }
      if (url.pathname === "/identity/me") {
        return new Response(JSON.stringify({
          org: { id: "org-two", name: "Two", kind: "organization", team: null },
          orgRole: "admin",
          teamId: null,
          projectRole: null,
          groupId: null,
          displayName: "Two User",
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const identity = await switchCurrentOrganization("org-two", "token-two");

    expect(identity.org.id).toBe("org-two");
    expect(calls.map(({ url }) => url.pathname)).toEqual(["/auth/switch-org", "/identity/me"]);
    expect(calls[0]!.init).toMatchObject({ method: "POST", body: JSON.stringify({ toOrgId: "org-two" }) });
    expect(calls[1]!.url.searchParams.get("orgId")).toBe("org-two");
    expect(calls.every(({ init }) => (init.headers as Record<string, string>).Authorization === "Bearer token-two")).toBe(true);
  });
});
