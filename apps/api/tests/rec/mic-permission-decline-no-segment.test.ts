/**
 * F69 AC2 — 拒绝或关闭麦克风的人本路显式标「未录制」且不再产生转写段。
 *
 * I-4 and I-5, as data-layer assertions rather than rendering ones. The distinction is the
 * whole point: the prototype already renders 「未录制」, and a badge is not a control. What is
 * asserted here is that the *store* stays empty — on all three carriers, through the one
 * shared path.
 *
 * I-4's stated form is `count(segments join tracks where micState='denied') === 0`, so the
 * final test computes exactly that join over the fake store rather than trusting the return
 * value of the call that was supposed to refuse.
 */
import { describe, expect, it } from "vitest";
import { CARRIERS, type SourceType } from "../../src/domain/recording/transcription-core";
import { ingestSegment, setMicState, startRecording } from "../../src/application/recording/capture";
import { blockingConsent, harness, missingRetention } from "../support/rec-fakes";

function anchorFor(carrier: SourceType, startMs: number, endMs: number) {
  return carrier === "thread"
    ? { startMs: null, endMs: null, messageId: `msg-${startMs}` }
    : { startMs, endMs, messageId: null };
}

/** One granted track, one denied track, on the given carrier. */
async function twoTrackSession(carrier: SourceType) {
  const deps = harness();
  const started = await startRecording(deps, {
    sourceType: carrier,
    sourceRefId: `ref-${carrier}`,
    projectId: "prj-1",
    orgId: "org-1",
    trackPlan: [
      { participantId: "p-yes", micState: "granted" },
      { participantId: "p-no", micState: "denied" },
    ],
  });
  if (!started.ok) throw new Error(`startRecording refused: ${started.reason}`);
  const [granted, denied] = started.tracks;
  if (granted === undefined || denied === undefined) throw new Error("track plan not honoured");
  return { deps, sessionId: started.sessionId, granted, denied };
}

describe("F69 · 拒绝/关闭麦克风的一路不产生转写段", () => {
  it("the denied track is a stored fact, not a rendering choice", async () => {
    for (const carrier of CARRIERS) {
      const { denied } = await twoTrackSession(carrier);
      // `denied` comes back from startRecording, so the 「未录制」 badge has something to read.
      expect(denied.micState, `${carrier}`).toBe("denied");
    }
  });

  it("I-4 · a denied track produces nothing, on every carrier", async () => {
    for (const carrier of CARRIERS) {
      const { deps, sessionId, granted, denied } = await twoTrackSession(carrier);

      const refused = await ingestSegment(deps, {
        sessionId,
        trackId: denied.trackId,
        anchor: anchorFor(carrier, 0, 900),
        rawText: "这句话不该被记下来",
        asrConfidence: 0.99,
        diarization: { channelId: "ch-B", overlap: false },
        draft: false,
      });
      expect(refused.ok, `${carrier}: a denied mic was allowed to transcribe`).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe("MIC_NOT_GRANTED");

      // Nothing was written — not "nothing was returned".
      expect(await deps.segments.ofTrack(denied.trackId)).toEqual([]);
      expect(deps.segments.appended).toHaveLength(0);

      // …and the refusal is about the microphone, not about the session: the granted track
      // in the same session keeps working. A gate that stopped everything would also pass
      // the assertion above.
      const ok = await ingestSegment(deps, {
        sessionId,
        trackId: granted.trackId,
        anchor: anchorFor(carrier, 0, 900),
        rawText: "这句话应该被记下来",
        asrConfidence: 0.99,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(ok.ok, `${carrier}: the granted track stopped working too`).toBe(true);
      expect(deps.segments.appended).toHaveLength(1);
    }
  });

  it("I-4 · the join the invariant actually states is empty", async () => {
    for (const carrier of CARRIERS) {
      const { deps, sessionId, granted, denied } = await twoTrackSession(carrier);
      for (const trackId of [granted.trackId, denied.trackId]) {
        await ingestSegment(deps, {
          sessionId,
          trackId,
          anchor: anchorFor(carrier, 1_000, 1_900),
          rawText: "内容",
          asrConfidence: 0.9,
          diarization: { channelId: null, overlap: false },
          draft: false,
        });
      }
      // count(segments ⋈ tracks where micState = 'denied') === 0
      let offending = 0;
      for (const seg of deps.segments.appended) {
        const track = await deps.tracks.track(seg.trackId);
        if (track?.timeline.micState === "denied") offending += 1;
      }
      expect(offending, `${carrier}: I-4 violated`).toBe(0);
      expect(deps.segments.appended.length, "vacuous — nothing was stored at all").toBe(1);
    }
  });

  it("I-5 · pausing leaves a gap; no segment may sit in it or span it", async () => {
    // Timecode carriers only — a chat thread has no timeline to leave a hole in.
    for (const carrier of CARRIERS.filter((c) => c !== "thread")) {
      const { deps, sessionId, granted } = await twoTrackSession(carrier);

      const paused = await setMicState(deps, {
        trackId: granted.trackId,
        micState: "paused",
        atMs: 5_000,
        actorParticipantId: "p-yes",
        actorIsFacilitator: false,
      });
      expect(paused.ok, `${carrier}: pause refused`).toBe(true);

      const duringPause = await ingestSegment(deps, {
        sessionId,
        trackId: granted.trackId,
        anchor: anchorFor(carrier, 6_000, 6_900),
        rawText: "静音期间不该有内容",
        asrConfidence: 0.9,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(duringPause.ok).toBe(false);
      if (!duringPause.ok) expect(duringPause.reason).toBe("MIC_NOT_GRANTED");

      const resumed = await setMicState(deps, {
        trackId: granted.trackId,
        micState: "granted",
        atMs: 9_000,
        actorParticipantId: "p-yes",
        actorIsFacilitator: false,
      });
      expect(resumed.ok).toBe(true);
      if (resumed.ok) {
        // The gap stays visible after resuming — 不拼接成连续假象.
        expect(resumed.gapRanges).toEqual([{ fromMs: 5_000, toMs: 9_000 }]);
      }

      // A segment that spans the closed gap would splice it shut.
      const spanning = await ingestSegment(deps, {
        sessionId,
        trackId: granted.trackId,
        anchor: anchorFor(carrier, 4_000, 10_000),
        rawText: "跨越缺口的一段",
        asrConfidence: 0.9,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(spanning.ok, `${carrier}: a segment spanned the gap`).toBe(false);

      // After the gap, capture resumes normally — the track is not poisoned.
      const after = await ingestSegment(deps, {
        sessionId,
        trackId: granted.trackId,
        anchor: anchorFor(carrier, 9_500, 10_400),
        rawText: "重开之后续接同一条转写",
        asrConfidence: 0.9,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(after.ok, `${carrier}: the track never recovered`).toBe(true);
      expect(deps.segments.appended).toHaveLength(1);
    }
  });

  it("`denied` is entry-time-only and terminal (see mic-state.ts header — an inference)", async () => {
    const { deps, granted, denied } = await twoTrackSession("workshop");

    const toDenied = await setMicState(deps, {
      trackId: granted.trackId,
      micState: "denied",
      atMs: 1_000,
      actorParticipantId: "p-yes",
      actorIsFacilitator: false,
    });
    expect(toDenied.ok).toBe(false);
    if (!toDenied.ok) expect(toDenied.reason).toBe("MIC_STATE_TRANSITION_INVALID");

    const outOfDenied = await setMicState(deps, {
      trackId: denied.trackId,
      micState: "granted",
      atMs: 1_000,
      actorParticipantId: "p-no",
      actorIsFacilitator: false,
    });
    expect(outOfDenied.ok).toBe(false);

    // …and the usecases.md example: 从未 granted 直接 paused.
    const straightToPaused = await setMicState(deps, {
      trackId: denied.trackId,
      micState: "paused",
      atMs: 1_000,
      actorParticipantId: "p-no",
      actorIsFacilitator: false,
    });
    expect(straightToPaused.ok).toBe(false);
  });

  it("turning someone else's mic off is refused server-side", async () => {
    const { deps, granted } = await twoTrackSession("interview");
    const notMine = await setMicState(deps, {
      trackId: granted.trackId,
      micState: "paused",
      atMs: 1_000,
      actorParticipantId: "p-stranger",
      actorIsFacilitator: false,
    });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.reason).toBe("NOT_TRACK_OWNER");

    // The facilitator may, and that is the only other way in.
    const asFacilitator = await setMicState(deps, {
      trackId: granted.trackId,
      micState: "paused",
      atMs: 1_000,
      actorParticipantId: "p-facilitator",
      actorIsFacilitator: true,
    });
    expect(asFacilitator.ok).toBe(true);
  });

  it("start is refused — and creates nothing — when consent or retention is missing", async () => {
    for (const carrier of CARRIERS) {
      const blocked = harness({ consent: blockingConsent });
      const r1 = await startRecording(blocked, {
        sourceType: carrier,
        sourceRefId: "ref-1",
        projectId: "prj-1",
        orgId: "org-1",
        trackPlan: [{ participantId: "p-a", micState: "granted" }],
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.reason).toBe("CONSENT_NOT_COMPLETED");
      expect(await blocked.tracks.tracksOf("rec-session-1")).toEqual([]);

      // I-33: no implicit 180-day fallback. Refuse, and create no session.
      const noRetention = harness({ retention: missingRetention });
      const r2 = await startRecording(noRetention, {
        sourceType: carrier,
        sourceRefId: "ref-1",
        projectId: "prj-1",
        orgId: "org-1",
        trackPlan: [{ participantId: "p-a", micState: "granted" }],
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.reason).toBe("RETENTION_POLICY_MISSING");
      expect(await noRetention.sessions.session("rec-session-1")).toBeUndefined();
    }
  });
});
