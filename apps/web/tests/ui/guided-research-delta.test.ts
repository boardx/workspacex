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

it("rebuilds independent historical source copies from the full merged patch in original order", () => {
  const source = { id: "s1", taskId: "t", title: "Source", url: "https://example.org/s", content: "real evidence", retrievedAt: "now", decision: "accepted" as const };
  const second = { ...source, id: "s2" };
  const previous = { title: "Previous", createdAt: "now", report: null, text: "", chapters: [], sources: [], outline: [], aliases: [] };
  const compact = { ...patch, changes: { sources: [source, second], reportPrevious: previous }, previousSourceIds: ["s2", "s1"], removed: [] };
  const next = mergeResearchDelta(state, compact);
  expect(next.reportPrevious?.sources.map(item => item.id)).toEqual(["s2", "s1"]);
  expect(next.reportPrevious?.sources[1]).not.toBe(next.sources[0]);
  next.sources[0]!.content = "changed current evidence";
  expect(next.reportPrevious?.sources[1]?.content).toBe("real evidence");
  const cleared = mergeResearchDelta(next, { ...patch, revision: 5, changes: { sources: [] }, removed: [] });
  expect(cleared.reportPrevious?.sources).toHaveLength(2);
  expect(() => mergeResearchDelta(state, { ...compact, previousSourceIds: ["missing"] })).toThrow("RESEARCH_STATE_SOURCE_REFERENCE_INVALID");
  expect(() => mergeResearchDelta(state, { ...compact, previousSourceIds: ["s1", "s1"] })).toThrow("RESEARCH_STATE_SOURCE_REFERENCE_INVALID");
});

it("restores shared bodies alongside explicit historical differences without borrowing current evidence", () => {
  const source = { id: "s1", taskId: "t", title: "Source", url: "https://example.org/s", content: "current fetched evidence", retrievedAt: "now", decision: "accepted" as const };
  const second = { ...source, id: "s2" };
  const historical = { ...source, content: "distinct archived evidence" };
  const previous = { title: "Previous", createdAt: "now", report: null, text: "", chapters: [], sources: [historical], outline: [], aliases: [] };
  const next = mergeResearchDelta(state, { ...patch, changes: { sources: [source, second], reportPrevious: previous }, previousSourceIds: ["s2", "s1"], removed: [] });
  expect(next.reportPrevious?.sources.map(item => item.content)).toEqual([second.content, historical.content]);
  expect(next.reportPrevious?.sources[0]).not.toBe(next.sources[1]);
  expect(() => mergeResearchDelta(state, { ...patch, changes: { sources: [source, second], reportPrevious: previous }, previousSourceIds: ["s2"], removed: [] })).toThrow("RESEARCH_STATE_SOURCE_REFERENCE_INVALID");
});
