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
 *   **⚠ 上面第一段（"X-7 / XC-18 are unresolved … three vs four"）现在是历史记录，
 *   保留是为了能看出裁过什么，不要删** —— 但它描述的状态**已于 2026-08-05 结束**，见下。
 *
 * ⚠ **2026-08-05 coord-main 经人类授权裁决（issue #533）：三项 / 四项之争已裁 —— 取四项。**
 *   裁决内容逐字：`recording` 的三项是 `interview` 四位的**严格子集、逐字相同、只少一位
 *   `attribution`**，那是**遗漏**的形状而非两套设计；且 `attribution`（能不能把某句话
 *   署名归到某个人）在工作坊 / 线程录音里同样成立 —— 少这一位意味着系统当时
 *   **记录不了工作坊参与者是否同意被引述**，那是真实的能力缺口，不是「简化」。
 *   ⇒ 两个枚举收敛为 `packages/contracts/src/consent-item.ts` 的 `CONSENT_ITEMS`（四项），
 *     `interview.ConsentKey` 与 `recording.RecordingConsentItem` 都是它的**别名**。
 *   ⇒ 本端口的立场**没有变**：它仍然只问「有没有单元格还 pending」，仍然不枚举项。
 *     变的只是矩阵的项数，而门禁读的是 `.options.length`（#465），所以基数自动跟到 4。
 *   门控：`tests/rec/consent-items-single-source.test.ts`（同一性 + 只有一处声明）
 *   ＋ `tests/rec/recording-consent-single-source.test.ts`（迁移 CHECK 逐字对账）。
 *   ⚠ 人类可推翻本裁决并回退到三项 —— 回退请改 `consent-item.ts`，不要在两束里各写一份。
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
