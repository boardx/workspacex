import { describe, it, expect } from "vitest";
import { mergeResearchProgress, type GuidedResearchRuntime, type ResearchRuntimeProgress } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
const current = { sessionId: "s", version: 2, reportStream: { requestId: "r", sequence: 1, text: "first", status: "streaming" } } as GuidedResearchRuntime;
const progress = { sessionId: "s", version: 2, stream: { requestId: "r", sequence: 2, offset: 5, delta: "second", status: "streaming" } } as ResearchRuntimeProgress;
describe("report progress cursor", () => {
  it("merges research source metadata while preserving previously downloaded evidence", () => {
    const state = { ...runtimeFixture("research"), busy: true };
    const update = { sessionId: state.sessionId, version: state.version, busy: true, currentNode: "research",
      stream: null, research: { cursor: "a".repeat(64), tasks: [{ ...state.tasks[0]!, status: "failed", errorCode: "RESEARCH_SEARCH_UNAVAILABLE" }],
        sources: [{ id: "source1", taskId: "t1", title: "Updated title", url: "https://example.org/policy", retrievedAt: "now", decision: "accepted" }, { id: "new", taskId: "t1", title: "New policy", url: "https://example.org/new", retrievedAt: "now", decision: "accepted" }] },
    } as ResearchRuntimeProgress;
    const next = mergeResearchProgress(state, update);
    expect(next.tasks[0]?.errorCode).toBe("RESEARCH_SEARCH_UNAVAILABLE");
    expect(next.sources.map((source) => source.title)).toEqual(["Updated title", "New policy"]);
    expect(next.sources[0]?.content).toBe("Retrieved evidence");
    expect(mergeResearchProgress(next, { ...update, research: { ...update.research!, sources: undefined } }).sources).toEqual(next.sources);
    expect(mergeResearchProgress(next, { ...update, research: { ...update.research!, sources: [] } }).sources).toEqual([]);
  });
  it("appends once and tolerates an SSE delta arriving before the progress response", () => {
    const next = mergeResearchProgress(current, progress);
    expect(next.reportStream?.text).toBe("firstsecond");
    expect(mergeResearchProgress(next, progress).reportStream?.text).toBe("firstsecond");
    expect(mergeResearchProgress(next, { ...progress, stream: { ...progress.stream!, sequence: 1 } }).reportStream?.text).toBe("firstsecond");
  });
  it("never revives terminal state and clears prior report artifacts during a new attempt", () => {
    const terminal = { ...current, busy: false };
    expect(mergeResearchProgress(terminal, { ...progress, busy: true })).toBe(terminal);
    const checkpoint = { basis: "active", chapters: [] } as never;
    const next = mergeResearchProgress({ ...current, report: {} as never, reportDraft: {} as never, reportCheckpoint: checkpoint }, { ...progress, version: 3, busy: true, currentNode: "report" });
    expect(next.report).toBeNull(); expect(next.reportDraft).toBeNull(); expect(next.reportCheckpoint).toBeNull();
  });
  it("preserves the durable checkpoint while polling the same report attempt", () => {
    const checkpoint = { basis: "active", chapters: [] } as never;
    const next = mergeResearchProgress(
      { ...current, busy: true, currentNode: "report", reportCheckpoint: checkpoint },
      { ...progress, busy: true, currentNode: "report" },
    );
    expect(next.reportCheckpoint).toBe(checkpoint);
  });
  it("resets text on a new server request and ignores another session", () => {
    expect(mergeResearchProgress(current, { ...progress, stream: { ...progress.stream!, requestId: "new", offset: 0, delta: "new" } }).reportStream?.text).toBe("new");
    expect(mergeResearchProgress(current, { ...progress, sessionId: "other" })).toBe(current);
  });
});

it("updates saved chapter progress without replacing durable chapter bodies", () => {
  const state = { ...runtimeFixture("report"), busy: true, reportSavedChapterCount: 1 };
  const update = { sessionId: state.sessionId, version: state.version, busy: true, currentNode: "report", stream: null, reportSavedChapterCount: 3 } as unknown as ResearchRuntimeProgress;
  const next = mergeResearchProgress(state, update);
  expect(next).toHaveProperty("reportSavedChapterCount", 3);
  expect(next.reportCheckpoint).toBe(state.reportCheckpoint);
  const newAttempt = mergeResearchProgress(next, { ...update, version: state.version + 1, reportSavedChapterCount: undefined });
  expect(newAttempt).toHaveProperty("reportSavedChapterCount", undefined);
});

it("does not rewind saved count when an older stream response arrives after SSE", () => {
  const state = { ...current, busy: true, revision: 10, reportSavedChapterCount: 3,
    reportStream: { requestId: "r", sequence: 9, text: "latest", status: "streaming" as const } };
  const delayed = { ...progress, busy: true, revision: 10, reportSavedChapterCount: 1,
    stream: { requestId: "r", sequence: 7, offset: 0, delta: "old", status: "streaming" as const } };
  expect(mergeResearchProgress(state, delayed)).toBe(state);
});
it("rejects an older durable revision even when stream sequence has not changed", () => {
  const state = { ...current, busy: true, revision: 10, reportSavedChapterCount: 3 };
  const delayed = { ...progress, busy: true, revision: 9, reportSavedChapterCount: 2,
    stream: { ...progress.stream!, sequence: state.reportStream!.sequence } };
  expect(mergeResearchProgress(state, delayed)).toBe(state);
  const newAttempt = mergeResearchProgress(state, { ...delayed, version: state.version + 1, revision: 11,
    currentNode: "report", reportSavedChapterCount: 0, stream: { ...delayed.stream, requestId: "new", sequence: 0, offset: 0, delta: "" } });
  expect(newAttempt).toHaveProperty("reportSavedChapterCount", 0);
  expect(newAttempt.reportStream?.requestId).toBe("new");
});
