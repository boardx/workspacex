import { beforeEach, expect, it, vi } from "vitest";
import { listAidtStageHistory } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
const stage = (revision = 2) => ({ projectId: "p/1", stageId: 1, revision, content: { schemaVersion: 1, draft: { fields: { initial: "学生原始命题" }, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions: [], updatedBy: "student-a", updatedAt: "2026-11-15T00:00:00.000Z" });
beforeEach(() => { mocks.request.mockReset(); });
it("uses the existing read-only history endpoint with validated cursor, captured token and abort signal", async () => {
  const signal = new AbortController().signal;
  mocks.request.mockResolvedValue({ items: [stage(2)], nextBeforeRevision: 2 });
  expect(await listAidtStageHistory("p/1", 1, "token", { beforeRevision: 3, limit: 1 }, signal)).toMatchObject({ items: [{ revision: 2 }], nextBeforeRevision: 2 });
  expect(mocks.request).toHaveBeenCalledWith("/projects/p%2F1/aidt/stages/1/revisions?limit=1&beforeRevision=3", { method: "GET", sessionToken: "token", signal });
});
it("rejects invalid input before issuing a request", async () => {
  for (const options of [{ limit: 101 }, { beforeRevision: 0 }]) await expect(listAidtStageHistory("p/1", 1, "token", options)).rejects.toThrow();
  await expect(listAidtStageHistory("p/1", 7, "token")).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects malformed, cross-scope, overlapping and non-progressing page readbacks", async () => {
  const invalid = [
    {},
    { items: [{ ...stage(), projectId: "other" }], nextBeforeRevision: null },
    { items: [{ ...stage(), stageId: 2 }], nextBeforeRevision: null },
    { items: [stage(3)], nextBeforeRevision: null },
    { items: [stage(1), stage(2)], nextBeforeRevision: null },
    { items: [stage(2), stage(2)], nextBeforeRevision: null },
    { items: [stage(2)], nextBeforeRevision: 1 },
    { items: [], nextBeforeRevision: 2 },
  ];
  for (const page of invalid) {
    mocks.request.mockResolvedValueOnce(page);
    await expect(listAidtStageHistory("p/1", 1, "token", { beforeRevision: 3 })).rejects.toThrow();
  }
});
it("preserves HTTP failures instead of presenting an empty history", async () => {
  mocks.request.mockRejectedValue(new Error("unavailable"));
  await expect(listAidtStageHistory("p/1", 1, "token")).rejects.toThrow("unavailable");
});
