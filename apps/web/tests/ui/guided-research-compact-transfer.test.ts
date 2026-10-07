import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api-client")>(), apiRequest: vi.fn() }));
import { apiRequest } from "@/lib/api-client";
import { getResearchRuntime, getResearchRuntimeProgress } from "@/lib/live-guided-research-api";
import { research as C } from "@repo/contracts";
const source = { id: "s1", taskId: "t", title: "Source", url: "https://example.org/s", content: "real fetched body", retrievedAt: "now", decision: "accepted" as const };
const state = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 2, revision: 3, currentNode: "report", availableNodes: ["brief", "report"], brief: { topic: "topic", goal: "goal", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [source], report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [], reportPrevious: { title: "Previous", createdAt: "now", report: null, text: "", chapters: [], sources: [], outline: [], aliases: [] } });
afterEach(() => vi.clearAllMocks());
it("requests compact refresh and reconstructs independently preserved historical bodies", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...state, previousSourceIds: ["s1"] });
  const hydrated = await getResearchRuntime("s");
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining("?compactSources=true"), expect.anything());
  expect(hydrated.reportPrevious?.sources).toEqual([source]);
  expect(hydrated.reportPrevious?.sources[0]).not.toBe(hydrated.sources[0]);
  expect(hydrated).not.toHaveProperty("previousSourceIds");
});
it("preserves a historical body that differs from the current source", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...state, reportPrevious: { ...state.reportPrevious!, sources: [{ ...source, content: "original archived evidence" }] } });
  expect((await getResearchRuntime("s")).reportPrevious?.sources[0]?.content).toBe("original archived evidence");
});
it("rejects unknown archive references instead of showing an empty historical source list", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...state, previousSourceIds: ["unknown"] });
  await expect(getResearchRuntime("s")).rejects.toMatchObject({ reasonCode: "RESEARCH_STATE_SOURCE_REFERENCE_INVALID" });
});
it("negotiates compact progress only alongside complete baseline fingerprints", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ type: "patch", sessionId: "s", version: 2, revision: 3, changes: {}, removed: [] });
  await getResearchRuntimeProgress("s", undefined, undefined, state);
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining("compactSources=true"));
});
