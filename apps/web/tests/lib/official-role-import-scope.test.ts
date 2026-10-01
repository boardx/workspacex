import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { enableOfficialRolePack } from "@/lib/agent-directory";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request }));
const offer = { packId: "official-role-pack", packVersion: "1.0.0", requiredSkillPacks: [
  { packId: "work-product", packVersion: "1.0.0" }, { packId: "work-design", packVersion: "1.0.0" },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue({}); });
describe("real official role import sequence scope", () => {
  it("binds every dependency and role POST to the initiating organization and token", async () => {
    const signal = new AbortController().signal;
    await enableOfficialRolePack(offer, undefined, { orgId: "org-a", sessionToken: "token-a", signal, isCurrent: () => true });
    expect(mocks.request).toHaveBeenCalledTimes(3);
    for (const [, request] of mocks.request.mock.calls) expect(request).toMatchObject({ sessionToken: "token-a", signal, body: { expectedOrgId: "org-a" } });
  });
  it.each([1, 2, 3])("rejects scope loss after POST %s without dispatching the next request", async (step) => {
    let current = true;
    mocks.request.mockImplementation(async () => { if (mocks.request.mock.calls.length === step) current = false; return {}; });
    await expect(enableOfficialRolePack(offer, undefined, { orgId: "org-a", sessionToken: "token-a", signal: new AbortController().signal, isCurrent: () => current })).rejects.toThrow("official_role_import_scope_changed");
    expect(mocks.request).toHaveBeenCalledTimes(step);
  });
  it("aborts before dispatch and never reports completion after cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(enableOfficialRolePack(offer, undefined, { orgId: "org-a", sessionToken: "token-a", signal: abort.signal, isCurrent: () => true })).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not swallow cancellation as an already-imported 409", async () => {
    const abort = new AbortController();
    mocks.request.mockImplementationOnce(async () => { abort.abort(); throw new ApiError(409, "conflict", {}); });
    await expect(enableOfficialRolePack(offer, undefined, { orgId: "org-a", sessionToken: "token-a", signal: abort.signal, isCurrent: () => true })).rejects.toThrow("official_role_import_scope_changed");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("retains legacy unscoped calls without adding scope fields", async () => {
    await enableOfficialRolePack(offer);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(mocks.request.mock.calls[0]![1].body).not.toHaveProperty("expectedOrgId");
  });
});
