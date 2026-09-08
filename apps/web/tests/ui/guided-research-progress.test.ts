import { describe, it, expect } from "vitest";
import { mergeResearchProgress, type GuidedResearchRuntime, type ResearchRuntimeProgress } from "@/lib/guided-research-api";
const current = { sessionId: "s", version: 2, reportStream: { requestId: "r", sequence: 1, text: "first", status: "streaming" } } as GuidedResearchRuntime;
const progress = { sessionId: "s", version: 2, stream: { requestId: "r", sequence: 2, offset: 5, delta: "second", status: "streaming" } } as ResearchRuntimeProgress;
describe("report progress cursor", () => {
  it("appends once and tolerates an SSE delta arriving before the progress response", () => {
    const next = mergeResearchProgress(current, progress);
    expect(next.reportStream?.text).toBe("firstsecond");
    expect(mergeResearchProgress(next, progress).reportStream?.text).toBe("firstsecond");
    expect(mergeResearchProgress(next, { ...progress, stream: { ...progress.stream!, sequence: 1 } }).reportStream?.text).toBe("firstsecond");
  });
  it("never revives terminal state and clears prior report bodies during a new attempt", () => {
    const terminal = { ...current, busy: false };
    expect(mergeResearchProgress(terminal, { ...progress, busy: true })).toBe(terminal);
    const next = mergeResearchProgress({ ...current, report: {} as never, reportDraft: {} as never, reportCheckpoint: {} as never }, { ...progress, version: 3, busy: true, currentNode: "report" });
    expect(next.report).toBeNull(); expect(next.reportDraft).toBeNull(); expect(next.reportCheckpoint).toBeNull();
  });
  it("resets text on a new server request and ignores another session", () => {
    expect(mergeResearchProgress(current, { ...progress, stream: { ...progress.stream!, requestId: "new", offset: 0, delta: "new" } }).reportStream?.text).toBe("new");
    expect(mergeResearchProgress(current, { ...progress, sessionId: "other" })).toBe(current);
  });
});
