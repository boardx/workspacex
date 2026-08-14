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

  it("describes owner-scoped tag, metadata update and delete operations", () => {
    expect(C.operations.createPersonalTranscription.path).toBe("/recording/realtime-asr/sessions");
    expect(C.operations.listPersonalTranscriptions.method).toBe("GET");
    expect(C.operations.readPersonalTranscription.path).toContain(":sessionId");
    expect(C.operations.updatePersonalTranscriptionContent.method).toBe("PATCH");
    expect(C.operations.updatePersonalTranscriptionContent.path).toContain("/content");
    expect(C.operations.issueRealtimeAsrTicket.path).toContain("/tickets");
    expect(C.operations.listPersonalTranscriptionTags).toMatchObject({
      method: "GET",
      path: "/recording/realtime-asr/tags",
    });
    expect(C.operations.updatePersonalTranscriptionMetadata).toMatchObject({
      method: "PATCH",
      path: "/recording/realtime-asr/sessions/:sessionId",
    });
    expect(C.operations.deletePersonalTranscription).toMatchObject({
      method: "DELETE",
      path: "/recording/realtime-asr/sessions/:sessionId",
    });
    expect(C.operations.updatePersonalTranscriptionMetadata.in.safeParse({
      sessionId: "session-1",
      name: "新名称",
      tags: ["客户", "复盘"],
    }).success).toBe(true);
    expect(C.operations.deletePersonalTranscription.out.safeParse({ deleted: true }).success).toBe(true);
    expect(C.operations.listPersonalTranscriptionTags.out.parse({
      tags: ["客户", "内部", "高优先级", "已归档", "市场研究", "合规"],
    }).tags).toHaveLength(6);
  });

  it("returns one editable body instead of captures and timestamped segments", () => {
    const detail = {
      sessionId: "session-1",
      name: "客户访谈",
      tags: ["客户"],
      status: "idle",
      durationMs: 1200,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:01.000Z",
      content: "第一句 第二句",
    };
    expect(C.PersonalTranscriptionDetail.safeParse(detail).success).toBe(true);
    expect(C.PersonalTranscriptionDetail.safeParse({ ...detail, captures: [] }).success).toBe(false);
    expect(C.PersonalTranscriptionStatus.safeParse("completed").success).toBe(false);
    expect(C.operations.updatePersonalTranscriptionContent.in.safeParse({
      sessionId: "session-1",
      content: "人工修改后的完整正文",
    }).success).toBe(true);
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

  it("keeps interim distinct from the persisted body", () => {
    expect(
      C.RealtimeAsrServerEvent.safeParse({
        type: "interim",
        captureId: "capture-1",
        text: "正在识别",
      }).success,
    ).toBe(true);
    expect(C.PersonalTranscriptionDetail.keyof().options).toContain("content");
    expect(C.PersonalTranscriptionDetail.keyof().options).not.toContain("captures");
  });
});
