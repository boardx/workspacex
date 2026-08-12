import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPersonalTranscription } from "@/lib/live-personal-transcriptions";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({ apiRequest: request }));

describe("live personal transcription compatibility", () => {
  beforeEach(() => request.mockReset());

  it("reopens a legacy completed response by folding capture segments into a resumable body", async () => {
    request.mockResolvedValue({
      sessionId: "legacy-session",
      name: "创建链路验证",
      tags: ["江西"],
      status: "completed",
      durationMs: 3_000,
      createdAt: "2026-08-12T07:02:10.755Z",
      updatedAt: "2026-08-12T09:16:10.990Z",
      captures: [{
        captureId: "capture-1",
        status: "completed",
        startedAt: "2026-08-12T09:15:27.076Z",
        endedAt: "2026-08-12T09:16:10.990Z",
        durationMs: 3_000,
        segments: [
          { segmentId: "segment-2", ordinal: 2, text: "第二句", startMs: 1_000, endMs: 2_000,
            createdAt: "2026-08-12T09:15:30.000Z" },
          { segmentId: "segment-1", ordinal: 1, text: "第一句", startMs: 0, endMs: 1_000,
            createdAt: "2026-08-12T09:15:29.000Z" },
        ],
      }],
    });

    await expect(readPersonalTranscription("legacy-session", "token")).resolves.toMatchObject({
      sessionId: "legacy-session",
      status: "idle",
      content: "第一句 第二句",
    });
  });

  it("accepts the previous single-body response while its status is still completed", async () => {
    request.mockResolvedValue({
      sessionId: "rolling-session", name: "滚动升级", tags: [], status: "completed",
      durationMs: 1_000, createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:01.000Z", content: "已有正文",
    });

    await expect(readPersonalTranscription("rolling-session", "token")).resolves.toMatchObject({
      status: "idle",
      content: "已有正文",
    });
  });
});
