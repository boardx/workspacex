import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runtimeProgress } from "../../src/interface/controllers/guided-research-progress";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const state = { sessionId: "s", version: 2, revision: 1, currentNode: "report", availableNodes: ["report"], busy: true, leaseUntil: null, errorCode: null, completed: false,
  reportStream: { requestId: "r", sequence: 3, text: "第一章第二章", status: "streaming" },
  sources: [{ content: "PRIVATE SOURCE".repeat(10000) }], messages: [{ text: "private" }], reportPrevious: { text: "history" },
} as unknown as ResearchRuntime;
describe("bounded report progress projection", () => {
  it("sends only missing text and excludes source, message and history bodies", () => {
    const result = runtimeProgress(state, "r", 3, createHash("sha256").update("第一章").digest("hex"));
    expect(result.stream).toMatchObject({ offset: 3, delta: "第二章", sequence: 3 });
    expect(JSON.stringify(result).length).toBeLessThan(600);
    expect(JSON.stringify(result).length / JSON.stringify(state).length).toBeLessThan(0.01);
    expect(result).not.toHaveProperty("sources"); expect(result).not.toHaveProperty("messages"); expect(result).not.toHaveProperty("reportPrevious");
    expect(runtimeProgress(state, "r", 6, createHash("sha256").update("第一章第二章").digest("hex")).stream?.delta).toBe("");
  });
  it("resets a foreign or out of bounds cursor instead of losing text", () => {
    expect(runtimeProgress(state, "r", 3, createHash("sha256").update("old").digest("hex")).stream?.offset).toBe(0);
    expect(runtimeProgress(state, "old", 3).stream).toMatchObject({ offset: 0, delta: "第一章第二章" });
    expect(runtimeProgress(state, "r", 999).stream?.offset).toBe(0);
  });
});
