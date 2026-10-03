import { expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { mergeResearchDelta } from "@/lib/guided-research-delta";
const state = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 2, revision: 3, currentNode: "outline", availableNodes: ["brief", "outline"], brief: { topic: "topic", goal: "goal", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [], report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [], reportPartial: true });
const patch = C.GuidedResearchRuntimePatch.parse({ type: "patch", sessionId: "s", version: 3, revision: 4, changes: { busy: true }, removed: ["reportPartial"] });
it("preserves unchanged steps, merges changed values and removes cleared optional fields", () => {
  const next = mergeResearchDelta(state, patch);
  expect(next.brief).toEqual(state.brief);
  expect(next.outline).toEqual(state.outline);
  expect(next.busy).toBe(true);
  expect(next).not.toHaveProperty("reportPartial");
  expect(state.reportPartial).toBe(true);
});
it("rejects foreign sessions and ignores out-of-order versions or revisions", () => {
  expect(() => mergeResearchDelta(state, { ...patch, sessionId: "other" })).toThrow();
  expect(mergeResearchDelta(state, { ...patch, version: 1 })).toBe(state);
  expect(mergeResearchDelta(state, { ...patch, version: 2, revision: 2 })).toBe(state);
});

it("keeps the requested baseline stream when an unchanged stream is omitted", () => {
  const baseline = { ...state, reportStream: { requestId: "r", sequence: 1, text: "old", status: "streaming" as const } };
  const next = mergeResearchDelta(baseline, { ...patch, changes: { busy: true }, removed: [] });
  expect(next.reportStream?.sequence).toBe(1);
});
it("merges compact source metadata without losing cached source evidence", () => {
  const previous = { ...state, sources: [{ id: "old", taskId: "task", title: "Old", url: "https://example.org/old", content: "cached evidence", retrievedAt: "now", decision: "accepted" as const }] };
  const next = mergeResearchDelta(previous, { ...patch, changes: {}, removed: [], research: { cursor: "a".repeat(64), sources: [{ ...previous.sources[0]!, title: "Updated" }, { id: "new", taskId: "task", title: "New", url: "https://example.org/new", retrievedAt: "now", decision: "pending" }] } });
  expect(next.sources.map((source) => source.content)).toEqual(["cached evidence", "New"]);
  expect(next.sources[0]?.title).toBe("Updated");
});

it("preserves the display-only checkpoint count when switching from legacy progress to patches", () => {
  expect(mergeResearchDelta({ ...state, reportSavedChapterCount: 2 }, patch).reportSavedChapterCount).toBe(2);
});
