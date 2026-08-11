import { describe, expect, it } from "vitest";
import * as C from "../src/personal-realtime-transcription";

describe("personal realtime transcription contract", () => {
  it("creates a personal document without a project id", () => {
    const parsed = C.operations.createPersonalTranscription.in.safeParse({
      name: "客户访谈",
      tags: ["客户", "市场研究"],
    });

    expect(parsed.success).toBe(true);
    expect(
      C.operations.createPersonalTranscription.in.safeParse({
        name: "客户访谈",
        tags: [],
        projectId: "project-must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("keeps project-role errors out of the personal API", () => {
    const errorCodes = Object.values(C.operations).flatMap((operation) => operation.err);
    expect(errorCodes).not.toContain("NO_PROJECT_ROLE");
    expect(errorCodes).toContain("TRANSCRIPTION_NOT_FOUND");
  });

  it("describes create, list, read and ticket HTTP operations", () => {
    expect(C.operations.createPersonalTranscription.path).toBe("/recording/realtime-asr/sessions");
    expect(C.operations.listPersonalTranscriptions.method).toBe("GET");
    expect(C.operations.readPersonalTranscription.path).toContain(":sessionId");
    expect(C.operations.issueRealtimeAsrTicket.path).toContain("/tickets");
  });

  it("requires capture identity on final and completed events", () => {
    expect(
      C.RealtimeAsrServerEvent.safeParse({
        type: "final",
        segmentId: "segment-1",
        captureId: "capture-1",
        text: "已落库文本",
        ordinal: 1,
        startMs: 0,
        endMs: 900,
      }).success,
    ).toBe(true);
    expect(
      C.RealtimeAsrServerEvent.safeParse({
        type: "final",
        segmentId: "segment-1",
        text: "缺少 captureId",
        ordinal: 1,
        startMs: 0,
        endMs: 900,
      }).success,
    ).toBe(false);
    expect(
      C.RealtimeAsrServerEvent.safeParse({ type: "completed", captureId: "capture-1" }).success,
    ).toBe(true);
    expect(C.RealtimeAsrServerEvent.safeParse({ type: "completed" }).success).toBe(false);
  });

  it("keeps interim distinct from persisted final segments", () => {
    expect(
      C.RealtimeAsrServerEvent.safeParse({
        type: "interim",
        captureId: "capture-1",
        text: "正在识别",
      }).success,
    ).toBe(true);
    expect(
      C.PersonalTranscriptionSegment.safeParse({
        segmentId: "segment-1",
        captureId: "capture-1",
        ordinal: 1,
        text: "最终文本",
        startMs: 0,
        endMs: 900,
        createdAt: "2026-08-11T00:00:00.000Z",
        status: "interim",
      }).success,
    ).toBe(false);
  });
});
