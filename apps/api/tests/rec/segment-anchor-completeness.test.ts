/**
 * F70 AC2 (数据层) — 「无可定位 anchor 的 Segment 不得入库」(I-1 / I-2, uc-5-1 R7)。
 *
 * `domain.md` I-1/I-2 give the assertion in SQL shape:
 *   `count(segments where anchor is null or (sourceType≠thread and (startMs is null or
 *   endMs is null)) or (sourceType=thread and messageId is null)) === 0`
 *   and `0 ≤ startMs < endMs ≤ session.durationMs`.
 *
 * This file proves the same thing as a pure function, without a database: every anchor shape
 * that `domain.md` calls incomplete is rejected by `transcribe()` before masking or status
 * derivation ever run (order matters — I-1 is checked first, see `transcribe`'s own comment),
 * and every shape it calls complete is accepted, for **both** anchor forms (timecode /
 * message id), across all three carriers.
 *
 * Two directions, same discipline as `multi-track-no-crosstalk.test.ts`'s carrier-table check:
 *   - REJECT: every incomplete shape in `INCOMPLETE_ANCHORS` fails with the contract's own
 *     error code, and — via `ingestSegment` + the fake store — never reaches persistence.
 *   - ACCEPT: the one complete shape per carrier is stored, and the anchor on the stored row
 *     is exactly the survivable range domain.md describes (I-2).
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  CARRIERS,
  transcribe,
  type RecordingErrorCode,
  type SegmentAnchor,
  type SourceType,
  type TranscriptionInput,
} from "../../src/domain/recording/transcription-core";
import { ingestSegment, startRecording } from "../../src/application/recording/capture";
import { harness } from "../support/rec-fakes";

const AUDIO_CARRIERS: readonly SourceType[] = CARRIERS.filter((c) => c !== "thread");
const SESSION_DURATION_MS = 60_000;

function baseInput(sourceType: SourceType, anchor: SegmentAnchor): TranscriptionInput {
  return {
    sessionId: "s-1",
    trackId: "t-1",
    sourceType,
    anchor,
    rawText: "hello",
    asrConfidence: 0.9,
    diarization: { channelId: "ch-A", overlap: false },
    draft: false,
    sessionDurationMs: SESSION_DURATION_MS,
  };
}

const passthroughPolicy = {
  isLowConfidence: () => false,
  mask: (raw: string) => ({ available: true as const, text: raw, findings: [] }),
};

function reasonFor(sourceType: SourceType, anchor: SegmentAnchor): RecordingErrorCode | null {
  const r = transcribe(baseInput(sourceType, anchor), passthroughPolicy);
  return r.ok ? null : r.reason;
}

describe("F70 · anchor 完整性是纯函数校验 (I-1 / I-2)", () => {
  it("the contract's own error codes are the ones this file asserts against", () => {
    // Not invented locally: both codes exist in the contract's error enum.
    expect(C.RecordingError.options).toContain("ANCHOR_MISSING");
    expect(C.RecordingError.options).toContain("ANCHOR_OUT_OF_RANGE");
  });

  describe("REJECT · 时间码载体 (workshop / interview)", () => {
    const cases: { name: string; anchor: SegmentAnchor; reason: RecordingErrorCode }[] = [
      { name: "startMs 缺失", anchor: { startMs: null, endMs: 900, messageId: null }, reason: "ANCHOR_MISSING" },
      { name: "endMs 缺失", anchor: { startMs: 100, endMs: null, messageId: null }, reason: "ANCHOR_MISSING" },
      { name: "两者皆缺", anchor: { startMs: null, endMs: null, messageId: null }, reason: "ANCHOR_MISSING" },
      {
        name: "messageId 也带着（两种锚点形态混用）",
        anchor: { startMs: 100, endMs: 900, messageId: "msg-1" },
        reason: "ANCHOR_OUT_OF_RANGE",
      },
      { name: "startMs 为负", anchor: { startMs: -1, endMs: 900, messageId: null }, reason: "ANCHOR_OUT_OF_RANGE" },
      {
        name: "零长度区间 (startMs === endMs)",
        anchor: { startMs: 500, endMs: 500, messageId: null },
        reason: "ANCHOR_OUT_OF_RANGE",
      },
      {
        name: "顺序颠倒 (startMs > endMs)",
        anchor: { startMs: 900, endMs: 100, messageId: null },
        reason: "ANCHOR_OUT_OF_RANGE",
      },
      {
        name: "endMs 超出 session 时长",
        anchor: { startMs: 100, endMs: SESSION_DURATION_MS + 1, messageId: null },
        reason: "ANCHOR_OUT_OF_RANGE",
      },
    ];

    for (const carrier of AUDIO_CARRIERS) {
      for (const c of cases) {
        it(`${carrier}: ${c.name} ⇒ ${c.reason}`, () => {
          expect(reasonFor(carrier, c.anchor)).toBe(c.reason);
        });
      }
    }
  });

  describe("REJECT · 消息载体 (thread)", () => {
    const cases: { name: string; anchor: SegmentAnchor; reason: RecordingErrorCode }[] = [
      { name: "messageId 缺失 (null)", anchor: { startMs: null, endMs: null, messageId: null }, reason: "ANCHOR_MISSING" },
      { name: "messageId 为空字符串", anchor: { startMs: null, endMs: null, messageId: "" }, reason: "ANCHOR_MISSING" },
      {
        name: "带了时间码（两种锚点形态混用）",
        anchor: { startMs: 0, endMs: 100, messageId: "msg-1" },
        reason: "ANCHOR_OUT_OF_RANGE",
      },
    ];
    for (const c of cases) {
      it(`thread: ${c.name} ⇒ ${c.reason}`, () => {
        expect(reasonFor("thread", c.anchor)).toBe(c.reason);
      });
    }
  });

  describe("ACCEPT · 每个载体各有一种合法锚点形态", () => {
    for (const carrier of AUDIO_CARRIERS) {
      it(`${carrier}: 合法时间码区间被接受，且原样保留在 segment 上`, () => {
        const anchor: SegmentAnchor = { startMs: 100, endMs: 900, messageId: null };
        const r = transcribe(baseInput(carrier, anchor), passthroughPolicy);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.segment.anchor).toEqual(anchor);
      });
    }

    it("thread: 合法 messageId 被接受，且原样保留在 segment 上", () => {
      const anchor: SegmentAnchor = { startMs: null, endMs: null, messageId: "msg-1" };
      const r = transcribe(baseInput("thread", anchor), passthroughPolicy);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.segment.anchor).toEqual(anchor);
    });
  });

  it("I-1 完整性断言：跑一批合法/非法输入之后，已入库集合里不存在任何不完整 anchor，且被拒的从未落库", async () => {
    const deps = harness();
    const started = await startRecording(deps, {
      sourceType: "workshop",
      sourceRefId: "ref-1",
      projectId: "prj-1",
      orgId: "org-1",
      trackPlan: [{ participantId: "p-1", micState: "granted" }],
    });
    if (!started.ok) throw new Error(`startRecording refused: ${started.reason}`);
    const trackId = started.tracks[0]?.trackId as string;

    const attempts: { anchor: SegmentAnchor; expectOk: boolean }[] = [
      { anchor: { startMs: 0, endMs: 100, messageId: null }, expectOk: true },
      { anchor: { startMs: null, endMs: null, messageId: null }, expectOk: false },
      { anchor: { startMs: 200, endMs: 100, messageId: null }, expectOk: false },
      { anchor: { startMs: 300, endMs: 400, messageId: null }, expectOk: true },
    ];

    for (const attempt of attempts) {
      const r = await ingestSegment(deps, {
        sessionId: started.sessionId,
        trackId,
        anchor: attempt.anchor,
        rawText: "x",
        asrConfidence: 0.9,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(r.ok).toBe(attempt.expectOk);
    }

    // Exactly the accepted attempts made it into the store — I-3's premise for a
    // downstream `indexedSegmentIds ⊆ segmentsWithAnchorIds` check.
    const stored = await deps.segments.ofTrack(trackId);
    expect(stored).toHaveLength(2);
    for (const seg of stored) {
      const complete =
        seg.anchor.messageId !== null ||
        (seg.anchor.startMs !== null && seg.anchor.endMs !== null && seg.anchor.startMs < seg.anchor.endMs);
      expect(complete, `stored segment has an incomplete anchor: ${JSON.stringify(seg.anchor)}`).toBe(true);
    }
  });
});
