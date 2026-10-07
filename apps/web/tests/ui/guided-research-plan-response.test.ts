import { beforeEach, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { apiRequest } from "@/lib/api-client";
import { executeResearchRuntime } from "@/lib/live-guided-research-api";

vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: vi.fn() }));
const baseline = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 7, revision: 2, currentNode: "outline", availableNodes: ["brief", "directions", "outline"],
  brief: { topic: "Public research", goal: "Answer confirmed questions", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [], report: null,
  completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], proposal: null,
  messages: [{ id: "prior", node: "brief", role: "assistant", text: "Previous topic conversation", createdAt: "now" }], modelCalls: [] });
const command = { sessionId: "s", requestId: "r", expectedVersion: 7, node: "outline" as const, action: "generate" as const };
const patch = C.GuidedResearchRuntimePatch.parse({ type: "patch", sessionId: "s", version: 8, revision: 3,
  changes: { directions: [], outline: [{ id: "o", title: "Confirmed plan", questions: ["What evidence?"], enabled: true, order: 0 }], researchPlan: null, busy: false, errorCode: null }, removed: [] });
const snapshot = () => C.GuidedResearchRuntime.parse({ ...baseline, ...patch.changes, version: patch.version, revision: patch.revision });
beforeEach(() => vi.mocked(apiRequest).mockReset());

it("hydrates a stage patch with no baseline using one GET and never repeats the POST", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockResolvedValueOnce(snapshot());
  expect(await executeResearchRuntime(command)).toEqual(snapshot());
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(apiRequest).mock.calls[0]).toEqual(["/research/guided-sessions/s/runtime/commands", expect.objectContaining({ method: "POST" })]);
  expect(vi.mocked(apiRequest).mock.calls[1]).toEqual(["/research/guided-sessions/s/runtime?compactSources=true", expect.objectContaining({ method: "GET" })]);
});
it("merges ordinary plan generation into the baseline without an extra GET", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(patch);
  const result = await executeResearchRuntime(command, undefined, undefined, baseline);
  expect(result.outline).toEqual(patch.changes.outline);
  expect(result.researchPlan).toBeNull();
  expect(result.messages).toEqual(baseline.messages);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it("hydrates only a successful plan message to retain both prior and new conversation history", async () => {
  const hydrated = { ...snapshot(), messages: [...baseline.messages, { id: "plan", node: "outline" as const, role: "assistant" as const, text: "Updated plan proposal", createdAt: "now" }] };
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockResolvedValueOnce(hydrated);
  const result = await executeResearchRuntime({ ...command, action: "message", message: "Update the plan" }, undefined, undefined, baseline);
  expect(result.messages).toEqual(hydrated.messages);
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("keeps a failed plan command's error/version and baseline history without hydrating or replaying", async () => {
  const failed = { ...patch, changes: { ...patch.changes, errorCode: "RESEARCH_PLAN_TIME_BUDGET_EXCEEDED" } };
  vi.mocked(apiRequest).mockResolvedValueOnce(failed);
  const result = await executeResearchRuntime({ ...command, action: "message", message: "Update the plan" }, undefined, undefined, baseline);
  expect(result).toMatchObject({ version: 8, revision: 3, busy: false, errorCode: "RESEARCH_PLAN_TIME_BUDGET_EXCEEDED" });
  expect(result.messages).toEqual(baseline.messages);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it("does not hydrate a stale plan message patch or replace the newer baseline", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, version: 6 });
  expect(await executeResearchRuntime({ ...command, action: "message", message: "Update" }, undefined, undefined, baseline)).toBe(baseline);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it.each([undefined, baseline])("rejects a foreign-session patch before any hydration", async current => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, sessionId: "foreign" });
  await expect(executeResearchRuntime(command, undefined, undefined, current)).rejects.toMatchObject({ reasonCode: "RESEARCH_STATE_SESSION_MISMATCH" });
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it.each([
  { ...snapshot(), sessionId: "foreign" },
  { ...snapshot(), version: 7 },
  { ...snapshot(), revision: 2 },
])("rejects hydration older than the command result or belonging to a different session", async hydrated => {
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockResolvedValueOnce(hydrated);
  await expect(executeResearchRuntime(command)).rejects.toThrow();
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("accepts a hydration newer than the command result without rewinding it", async () => {
  const hydrated = { ...snapshot(), version: 9, revision: 1, busy: true };
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockResolvedValueOnce(hydrated);
  expect(await executeResearchRuntime(command)).toEqual(hydrated);
});
it("keeps legacy full response compatibility and does not add GET to other-node messages", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(snapshot());
  expect(await executeResearchRuntime(command)).toEqual(snapshot());
  vi.mocked(apiRequest).mockResolvedValueOnce(patch);
  const result = await executeResearchRuntime({ ...command, node: "brief", action: "message", message: "Update topic" }, undefined, undefined, baseline);
  expect(result.messages).toEqual(baseline.messages);
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("propagates hydration failure without replaying an already executed command", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockRejectedValueOnce(new Error("GET unavailable"));
  await expect(executeResearchRuntime(command)).rejects.toThrow("GET unavailable");
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("merges actual plan invalidation without retaining old sources or report checkpoint display", async () => {
  const current = { ...baseline, sources: [{ id: "old", taskId: "t", title: "Old source", url: "https://example.org/old", content: "Old evidence", retrievedAt: "now", decision: "accepted" as const }],
    reportCheckpoint: { basis: "old", chapters: [] }, reportSavedChapterCount: 4, reportSourceAliases: [{ alias: "1", sourceId: "old" }], reportPartial: true };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, changes: { ...patch.changes, sources: [], tasks: [], report: null, reportCheckpoint: null, reportSourceAliases: [], reportPartial: false } });
  const result = await executeResearchRuntime({ ...command, action: "save" }, undefined, undefined, current);
  expect(result.sources).toEqual([]);
  expect(result.reportCheckpoint).toBeNull();
  expect(result.reportSavedChapterCount).toBe(0);
  expect(result.reportSourceAliases).toEqual([]);
  expect(result.reportPartial).toBe(false);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it("keeps retrieved evidence when chapter-only edits omit unchanged nonempty sources", async () => {
  const current = { ...baseline, sources: [{ id: "old", taskId: "t", title: "Evidence", url: "https://example.org/old", content: "Retained evidence", retrievedAt: "now", decision: "accepted" as const }] };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, changes: { ...patch.changes, report: null, reportCheckpoint: null } });
  const result = await executeResearchRuntime({ ...command, action: "save_chapters" }, undefined, undefined, current);
  expect(result.sources).toEqual(current.sources);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it.each([["save", false], ["save", true], ["save_chapters", false], ["save_chapters", true]] as const)("hydrates historical report after %s (existing older history=%s)", async (action, olderHistory) => {
  const report = C.GuidedResearchReport.parse({ title: "Original report", summary: "Prior conclusions", sections: [{ sectionId: "o", body: "Original report body", sourceIds: [] }] });
  const previous = { title: "Original report", createdAt: "now", report, draft: null, text: "", chapters: [], sources: [], outline: [], aliases: [], qualityWarnings: [], partial: false, evidenceWarnings: [] };
  const current = C.GuidedResearchRuntime.parse({ ...baseline, report, ...(olderHistory ? { reportPrevious: { ...previous, report: { ...report, sections: [{ sectionId: "o", body: "Older report body", sourceIds: [] }] } } } : {}) });
  const hydrated = { ...snapshot(), report: null, reportPrevious: previous };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, changes: { ...patch.changes, report: null } }).mockResolvedValueOnce(hydrated);
  const result = await executeResearchRuntime({ ...command, action }, undefined, undefined, current);
  expect(result.report).toBeNull();
  expect(result.reportPrevious?.report?.sections[0]?.body).toBe("Original report body");
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("rejects a hydration that completes after its signal was aborted", async () => {
  let finish!: (value: unknown) => void;
  const controller = new AbortController();
  vi.mocked(apiRequest).mockResolvedValueOnce(patch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const execution = executeResearchRuntime(command, undefined, controller.signal);
  await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  controller.abort(); finish(snapshot());
  await expect(execution).rejects.toMatchObject({ name: "AbortError" });
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("hydrates newly generated research tasks and sources when plan confirmation advances to research", async () => {
  const hydrated = { ...snapshot(), currentNode: "research" as const, tasks: [{ id: "t", sectionId: "o", query: "Official evidence", status: "succeeded" as const, attempts: 1, errorCode: null }],
    sources: [{ id: "new", taskId: "t", title: "New evidence", url: "https://example.org/new", content: "Retrieved evidence", retrievedAt: "now", decision: "accepted" as const }] };
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, changes: { ...patch.changes, currentNode: "research" } }).mockResolvedValueOnce(hydrated);
  const result = await executeResearchRuntime({ ...command, action: "confirm" }, undefined, undefined, baseline);
  expect(result.tasks).toEqual(hydrated.tasks);
  expect(result.sources).toEqual(hydrated.sources);
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("retains the acknowledged stage snapshot when its required hydration fails, without replaying POST", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...patch, changes: { ...patch.changes, currentNode: "research" } }).mockRejectedValueOnce(new Error("GET unavailable"));
  await expect(executeResearchRuntime({ ...command, action: "confirm" }, undefined, undefined, baseline)).rejects.toMatchObject({
    name: "ResearchRuntimeHydrationError", snapshot: { sessionId: "s", version: 8, revision: 3, currentNode: "research", outline: patch.changes.outline },
  });
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
