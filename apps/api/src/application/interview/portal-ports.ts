/**
 * Ports for F96 —— 受访者自助门户三项能力（uc-6-6 R3）。
 *
 * 三个端口分别对应三项能力各自需要、而 F86/F89 都还没有的持久化面：
 *
 *   · `PortalConsentStateRepository` —— 「当前」同意位是什么。F86 的
 *     `ConsentSnapshotRepository` 只存**原始**那一份（提交时刻，不随后续变更改写，AC5），
 *     门户改选择产生的是一条**独立的追加历史**（I-16：只追加不覆盖），两者不是同一张表。
 *   · `SubjectRequestRepository` —— 受访者三项动作各自的请求记录，供状态可查（V6）。
 *   · `TranscriptCopySourceReader` / `TranscriptCopyFileStore` —— 文字稿副本的取数与落盘，
 *     与 `export-file-ports.ts`（F98）同一手法：先声明端口形状 + 内存 stand-in，
 *     真正接入对象存储/22-files 是另一条尚未落地的地基（同 issue #74 口径）。
 *
 * ⚠ 与 F89 共用的是 `WithdrawalRepository` 那一条撤回底座（`withdrawal-ports.ts`），
 *   本文件**不**重复声明撤回相关的类型——收紧同意位/删除全部记录都直接调用
 *   `requestWithdrawal`（`request-withdrawal.ts`），这里只加"门户视角"专属的存储面。
 */
import type { ConsentBits } from "../../domain/interview/portal-request";

export type SubjectRequestKindValue = "transcript-copy" | "erasure" | "consent-change";

/* ─────────────────────────── 当前同意位（门户改选择的历史） ─────────────────────────── */

export interface ConsentBitsChangeRecord {
  readonly bits: ConsentBits;
  readonly changedAt: Date;
}

export interface AppendConsentBitsChangeInput {
  readonly submissionId: string;
  readonly subjectId: string;
  readonly bits: ConsentBits;
  readonly changedAt: Date;
}

export interface PortalConsentStateRepository {
  /**
   * 最近一次变更（不存在时返回 `null`——表示该受访者自提交以来从未通过门户改过选择，
   * 调用方应回退到 `submitConsent` 落的原始 bits，见 `get-portal-view.ts`）。
   */
  getCurrentBits(subjectId: string): Promise<ConsentBitsChangeRecord | null>;
  /** 追加一条历史版本，**不覆盖**旧记录（I-16）。 */
  appendChange(input: AppendConsentBitsChangeInput): Promise<void>;
}

export const PORTAL_CONSENT_STATE_REPOSITORY = Symbol("PortalConsentStateRepository");

/* ─────────────────────────── 受访者请求（状态可查，V6） ─────────────────────────── */

export interface SubjectRequestRow {
  readonly requestId: string;
  readonly subjectId: string;
  readonly kind: SubjectRequestKindValue;
  readonly createdAt: Date;
  /**
   * `erasure` / 触发了撤回的 `consent-change` 关联的撤回单据 id——状态与预计完成时间
   * 现算自这张单据的五步快照（随流水线推进更新，V6），不在这里存一份会漂移的静态状态。
   * `transcript-copy` 与未触发撤回的 `consent-change` 恒为 `null`：它们的结果在
   * 创建那一刻就已是终态。
   */
  readonly withdrawalId: string | null;
  /** 仅当 `withdrawalId === null` 时有意义——创建时就已确定的终态文案与到期时间。 */
  readonly fixedStatus: string | null;
  readonly fixedEtaAt: string | null;
}

export interface CreateSubjectRequestInput {
  readonly requestId: string;
  readonly subjectId: string;
  readonly kind: SubjectRequestKindValue;
  readonly createdAt: Date;
  readonly withdrawalId: string | null;
  readonly fixedStatus: string | null;
  readonly fixedEtaAt: string | null;
}

export interface SubjectRequestRepository {
  create(input: CreateSubjectRequestInput): Promise<SubjectRequestRow>;
  listBySubject(subjectId: string): Promise<readonly SubjectRequestRow[]>;
}

export const SUBJECT_REQUEST_REPOSITORY = Symbol("SubjectRequestRepository");

/* ─────────────────────────── 文字稿副本（只含本人发言） ─────────────────────────── */

/** 一段发言。`speakerSubjectId` 用于过滤——副本只含 `speakerSubjectId === 本人` 的行。 */
export interface TranscriptLine {
  readonly speakerSubjectId: string;
  readonly text: string;
}

export interface TranscriptCopySourceReader {
  /** 该场访谈**全部**发言（含他人）——过滤只含本人的职责在 use case 层，不在这个端口里做。 */
  linesFor(interviewId: string): Promise<readonly TranscriptLine[]>;
}

export const TRANSCRIPT_COPY_SOURCE_READER = Symbol("TranscriptCopySourceReader");

export interface TranscriptCopyFile {
  readonly downloadUrl: string;
  readonly expiresAt: Date;
}

export interface TranscriptCopyFileStore {
  /** 生成短时效、一次性下载链接（[设计] file-first）。可能失败——由调用方转 `COPY_GENERATION_FAILED`（E5）。 */
  put(subjectId: string, lines: readonly string[], now: Date): Promise<TranscriptCopyFile>;
}

export const TRANSCRIPT_COPY_FILE_STORE = Symbol("TranscriptCopyFileStore");
