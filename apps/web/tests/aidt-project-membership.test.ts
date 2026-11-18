import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readAidtProjectMembership } from "@/features/aidt/lib/aidt-project-membership";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); mocks.request.mockResolvedValue({ members: [{ userId: "me", displayName: "学生", role: "collaborator" }] }); });
afterEach(() => vi.unstubAllEnvs());
it("reuses the native collaborator contract with captured bearer and cancellation", async () => {
  const controller = new AbortController(); expect(await readAidtProjectMembership("p/1", "me", "captured-token", controller.signal)).toBe("collaborator");
  expect(mocks.request).toHaveBeenCalledWith("/projects/p%2F1/collaborators", { method: "GET", sessionToken: "captured-token", signal: controller.signal });
});
it("a readable managed roster without the actor never establishes membership", async () => { expect(await readAidtProjectMembership("p", "admin", "t")).toBeNull(); });
it("dependency failures and malformed rosters stay errors", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline")); await expect(readAidtProjectMembership("p", "me", "t")).rejects.toThrow("offline");
  mocks.request.mockResolvedValueOnce({ members: [] , simulatedOwner: true }); await expect(readAidtProjectMembership("p", "me", "t")).rejects.toThrow();
});
it("rejects duplicate membership identity rather than selecting a preferred role", async () => { mocks.request.mockResolvedValue({ members: [{ userId: "me", displayName: "", role: "owner" },{userId:"me",displayName:"",role:"collaborator"}] }); await expect(readAidtProjectMembership("p", "me", "t")).rejects.toThrow("AIDT_MEMBERSHIP_INCONSISTENT"); });
it("missing identity and cancelled reads make no request even with legacy flags", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "false");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); await expect(readAidtProjectMembership("p","","t")).rejects.toThrow();
  const controller=new AbortController();controller.abort();await expect(readAidtProjectMembership("p","me","t",controller.signal)).rejects.toThrow();expect(mocks.request).not.toHaveBeenCalled();
});
