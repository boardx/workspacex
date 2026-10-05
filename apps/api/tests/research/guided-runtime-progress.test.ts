import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runtimeProgress } from "../../src/interface/controllers/guided-research-progress";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const state = { sessionId: "s", version: 2, revision: 1, currentNode: "report", availableNodes: ["report"], busy: true, leaseUntil: null, errorCode: null, completed: false,
  reportStream: { requestId: "r", sequence: 3, text: "第一章第二章", status: "streaming" },
  sources: [{ content: "PRIVATE SOURCE".repeat(10000) }], messages: [{ text: "private" }], reportPrevious: { text: "history" },
} as unknown as ResearchRuntime;
describe("bounded report progress projection", () => {
  it("returns changed research source metadata without excerpts or fetched document bodies", () => {
    const research = { ...state, currentNode: "research" as const, reportStream: null,
      tasks: [{ id: "t", sectionId: "o", query: "policy", status: "failed" as const, attempts: 1, errorCode: "RESEARCH_SEARCH_UNAVAILABLE" }],
      sources: [{ id: "src", taskId: "t", title: "Official policy", url: "https://example.org/policy", retrievedAt: "now", decision: "accepted" as const, content: "PRIVATE EXCERPT".repeat(1000), document: { text: "PRIVATE DOCUMENT".repeat(1000) } }],
    } as unknown as ResearchRuntime;
    const first = runtimeProgress(research);
    expect(first.research?.sources?.[0]?.title).toBe("Official policy");
    expect(first.research?.tasks[0]?.errorCode).toBe("RESEARCH_SEARCH_UNAVAILABLE");
    expect(JSON.stringify(first)).not.toContain("PRIVATE");
    expect(JSON.stringify(first).length).toBeLessThan(2000);
    const unchanged = runtimeProgress(research, undefined, 0, undefined, first.research?.cursor);
    expect(unchanged.research?.sources).toBeUndefined();
  });
  it("sends only missing text and excludes source, message and history bodies", () => {
    const result = runtimeProgress(state, "r", 3, createHash("sha256").update("第一章").digest("hex"));
    expect(result.stream).toMatchObject({ offset: 3, delta: "第二章", sequence: 3 });
    expect(JSON.stringify(result).length).toBeLessThan(600);
    expect(JSON.stringify(result).length / JSON.stringify(state).length).toBeLessThan(0.01);
    expect(result).not.toHaveProperty("sources"); expect(result).not.toHaveProperty("messages"); expect(result).not.toHaveProperty("reportPrevious");
    expect(runtimeProgress(state, "r", 6, createHash("sha256").update("第一章第二章").digest("hex")).stream?.delta).toBe("");
  });
  it("publishes actionable quality warnings while later chapters are running", () => {
    const warnings = [{ sectionId: "chapter-1", issues: ["补充政策适用范围证据"] }];
    expect(runtimeProgress({ ...state, reportQualityWarnings: warnings }).reportQualityWarnings).toEqual(warnings);
  });
  it("resets a foreign or out of bounds cursor instead of losing text", () => {
    expect(runtimeProgress(state, "r", 3, createHash("sha256").update("old").digest("hex")).stream?.offset).toBe(0);
    expect(runtimeProgress(state, "old", 3).stream).toMatchObject({ offset: 0, delta: "第一章第二章" });
    expect(runtimeProgress(state, "r", 999).stream?.offset).toBe(0);
  });
});

it("projects durable saved chapter count without chapter bodies", () => {
  const result = runtimeProgress({ ...state, reportCheckpoint: { basis: "current", chapters: [{ sectionId: "one", body: "PRIVATE CHAPTER".repeat(10000) }, { sectionId: "two", body: "PRIVATE CHAPTER" }] } } as unknown as ResearchRuntime);
  expect(result).toHaveProperty("reportSavedChapterCount", 2);
  expect(JSON.stringify(result)).not.toContain("PRIVATE CHAPTER");
  expect(result).not.toHaveProperty("reportCheckpoint");
  expect(JSON.stringify(result).length).toBeLessThan(600);
});

it("accepts legacy activity/progress without an execution stamp, validates optional stamps and preserves historical versions", async () => {
  const { research: C } = await import("@repo/contracts");
  const event = { id: "old", sequence: 1, stage: "reading", taskId: null, summary: "Saved source preparation", occurredAt: "now", status: "started" };
  expect(C.GuidedResearchActivityEvent.safeParse(event).success).toBe(true);
  expect(C.GuidedResearchActivityEvent.parse({ ...event, executionVersion: 0 }).executionVersion).toBe(0);
  for (const executionVersion of [-1, 1.5, "2"]) expect(C.GuidedResearchActivityEvent.safeParse({ ...event, executionVersion }).success).toBe(false);
  const progress = { stage: "organizing", completed: 0, total: 1 };
  expect(C.GuidedResearchRuntime.shape.progress.safeParse(progress).success).toBe(true);
  expect(C.GuidedResearchRuntime.shape.progress.parse({ ...progress, executionVersion: 1 })?.executionVersion).toBe(1);
  for (const executionVersion of [-1, 1.5, "2"]) expect(C.GuidedResearchRuntime.shape.progress.safeParse({ ...progress, executionVersion }).success).toBe(false);
  const projected = runtimeProgress({ ...state, activity: [{ ...event, stage: "reading", status: "started", executionVersion: 0 }], progress: { ...progress, stage: "organizing", executionVersion: 1 } } as ResearchRuntime);
  expect(projected.activity?.[0]?.executionVersion).toBe(0); expect(projected.progress?.executionVersion).toBe(1);
});

it("keeps the run version stable during pause/resume and never stamps an inherited progress object", async () => {
  const { research: C } = await import("@repo/contracts");
  const { applyResearchSteering } = await import("../../src/application/research/guided-runtime-service");
  const current = { ...state, activity: [], progress: { stage: "organizing", completed: 1, total: 2, executionVersion: 1 } } as ResearchRuntime;
  for (const [index, action] of ["pause", "resume"].entries()) {
    applyResearchSteering(current, C.GuidedResearchRuntimeCommand.parse({ sessionId: "s", requestId: action, expectedVersion: 2, node: "report", action, expectedRevision: index, idempotencyKey: action }));
    expect(current.version).toBe(2); expect(current.progress?.executionVersion).toBe(1);
    expect(current.activity?.at(-1)?.executionVersion).toBe(2);
  }
});
