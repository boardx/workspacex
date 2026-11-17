import { beforeEach, expect, it, vi } from "vitest";
import { readAidtRunContext } from "@/features/aidt/lib/live-aidt-run-context";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
function receipt() { return { runId: "r", projectId: "p", purpose: "stage", stageId: 1, skillVersionId: "skill-v1", snapshotHash: "a".repeat(64), preparedAt: "2026-11-16T00:00:00Z", stageRevisions: [{ stageId: 1, revision: 2 }], historyRevisions: [], omissions: [], truncated: false, application: { state: "prepared", attemptId: null, assembledContextHash: null, assembledAt: null, messageDispatchedAt: null, checkpointResumedAt: null, inheritedMessageDispatchAttemptId: null } }; }
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue(receipt()); });
it("uses only the canonical read endpoint and the caller's token/signal", async () => {
  const signal = new AbortController().signal;
  expect((await readAidtRunContext({ projectId: "p", runId: "r" }, "captured-token", signal)).stageRevisions).toEqual([{ stageId: 1, revision: 2 }]);
  expect(mocks.request).toHaveBeenCalledWith("/agent-runs/r/aidt-context", { method: "GET", sessionToken: "captured-token", signal });
});
it.each([{ projectId: "another-group" }, { runId: "another-run" }])("rejects a valid response from a different scope %o", async mismatch => {
  mocks.request.mockResolvedValue({ ...receipt(), ...mismatch });
  await expect(readAidtRunContext({ projectId: "p", runId: "r" }, "token")).rejects.toThrow("SCOPE_MISMATCH");
});
it("rejects unexpected content instead of presenting it as trusted receipt metadata", async () => {
  mocks.request.mockResolvedValue({ ...receipt(), sourceText: "Student text or a private provider response" });
  await expect(readAidtRunContext({ projectId: "p", runId: "r" }, "token")).rejects.toThrow();
});
