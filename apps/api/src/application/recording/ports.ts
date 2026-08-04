/**
 * F69 — the ports the recording capture layer needs, and the one that carries the invariant.
 *
 * `SegmentStore.append` takes a `TranscribedSegment`, whose brand is unforgeable outside
 * `domain/recording/transcription-core.ts`. That single signature is what turns 「三载体共享
 * 一套转写能力」 from a sentence into a compile error: **there is no way to write a workshop-
 * only, interview-only or thread-only transcriber whose output can be stored.**
 *
 * ⚠ F69 ships **no PostgreSQL implementation**, deliberately. The `segments` / `tracks` tables
 * are shaped by F70–F73 (speaker channels, quotes, materialisation) and inventing them now
 * would be guessing at a schema those features have to live with — the same call
 * `application/context-pack/ports.ts` made for F12. What F69 owns is the SHAPE of the
 * questions capture asks, plus the domain rules; the fakes in `tests/support/rec-fakes.ts`
 * are what the structural assertions run against, which is what the feature's `notes` ask for
 * (「AC1 跨路隔离为结构断言」).
 */
import type {
  SourceType,
  TranscribedSegment,
} from "../../domain/recording/transcription-core";
import type { MicState, TrackTimeline } from "../../domain/recording/mic-state";

/** A capture session, as capture needs to see it. */
export interface RecordingSessionState {
  readonly sessionId: string;
  readonly projectId: string;
  readonly sourceType: SourceType;
  readonly endedAt: string | null;
  readonly durationMs: number;
}

/** One track's state. `participantId` is null for a room mic with no single owner. */
export interface TrackState {
  readonly trackId: string;
  readonly sessionId: string;
  readonly participantId: string | null;
  readonly timeline: TrackTimeline;
}

export interface SessionStore {
  session(sessionId: string): Promise<RecordingSessionState | undefined>;
  create(input: {
    sessionId: string;
    projectId: string;
    sourceType: SourceType;
    sourceRefId: string;
  }): Promise<void>;
  /** For `SESSION_ALREADY_RECORDING`: one live session per `sourceRefId`. */
  liveSessionFor(sourceRefId: string): Promise<string | undefined>;
}

export interface TrackStore {
  track(trackId: string): Promise<TrackState | undefined>;
  tracksOf(sessionId: string): Promise<readonly TrackState[]>;
  create(track: TrackState): Promise<void>;
  updateTimeline(trackId: string, timeline: TrackTimeline): Promise<void>;
}

/**
 * ⚠ The only way a segment reaches storage.
 *
 * Widening this parameter to a plain object type would delete the entire F69 invariant, so
 * `tests/rec/multi-track-no-crosstalk.test.ts` compiles a counter-proof fixture that tries
 * exactly that and asserts `tsc` rejects it.
 */
export interface SegmentStore {
  append(segment: TranscribedSegment): Promise<{ segmentId: string }>;
  /** Read back one track's segments — used by the cross-track isolation assertion. */
  ofTrack(trackId: string): Promise<readonly TranscribedSegment[]>;
}

/**
 * The consent matrix gate (`CONSENT_NOT_COMPLETED`).
 *
 * ⚠ **F69 consumes this, it does not define it.** `X-7` / `XC-18` are unresolved: the repo
 * holds three versions of how participant consent splits into items (three vs four), and
 * `domain.md` X-7 says in as many words 「本束不得自己拆」 while `ui.md` S-09 records that the
 * prototype split it anyway. So this port asks one question — *is any cell still pending?* —
 * and the answer comes from whoever owns the matrix. Nothing here enumerates the items.
 *
 * ⚠ 2026-08-04 coord-main 裁决（issue #465 / PR #500）：**存储表不算第二份事实**——
 *   X-7 管的是「授权项**定义**」（「必须读同一份授权项定义，不得自己拆」），不是
 *   「提交记录存哪张表」，所以 `recording_consent_cells` 可以存在，它的项来自已签核契约的
 *   `RecordingConsentItem`（一处定义，机械对账见
 *   `tests/rec/recording-consent-single-source.test.ts`）。
 *   **⚠ 上面那段没有过时，不许删、也不许改成「已解决」**：X-7 的三项（recording 契约）
 *   vs 四项（`interview_consent_submissions` 的四个布尔列）之争**仍未裁**，是产品语义问题，
 *   需要人类。裁决只回答了「表能不能建」，没有回答「到底几项」。
 *   把这段注释改成「已解决」，正是本仓 2026-08-05 一天里发现四处的那种**会说谎的注释**。
 */
export interface ConsentGate {
  /** True ⇒ `startRecording` must refuse. Equivalent to `getConsentMatrix.blocksStart`. */
  blocksStart(sourceRefId: string): Promise<boolean>;
}

/**
 * The org/project retention parameters (I-32 / I-33 / X-4).
 *
 * `undefined` ⇒ `RETENTION_POLICY_MISSING` ⇒ **refuse to start**. There is no fallback
 * constant here and there must never be one: O-01's default 180 days is the *retention
 * kernel's* config seed, not this module's constant.
 */
export interface RetentionResolver {
  resolve(input: { projectId: string; orgId: string }): Promise<
    { resolvedDays: number; resolvedFrom: "project" | "org"; resolvedAt: string } | undefined
  >;
}

/** Session/track id minting, kept out of the use cases so tests are deterministic. */
export interface IdGenerator {
  next(prefix: string): string;
}

export type { MicState, TrackTimeline, SourceType, TranscribedSegment };
