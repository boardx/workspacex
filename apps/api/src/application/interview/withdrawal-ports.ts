/**
 * Ports for F89 —— 五步撤回编排 + 级联失效（uc-6-3 R4/A4）。
 *
 * 端口切分沿用 `voiceprint-destruction-ports.ts`（F75）的思路：「找出引用它的派生物 →
 * 失效派生物 → 写审计/通知」是同一种形状，这里换成撤回语境的三条链路
 * （检索 / 报告证据 / 决策复核）+ 一条通用级联失效（OCR/embedding/图边/摘要/缓存）。
 *
 * ⚠ 本 feature **不**实现物理删除的执行（第 05 步）——那属于 22-files（uc-22-4）与
 *   17-gov（UC-17.2），与 F14 头部注释同一分工："只做触发，不做执行"。
 *   `PendingDeletionQueue.enqueue` 只负责把一张单据放进待删除队列；
 *   `WithdrawalRepository.markPhysicalDeleteComplete` 是**回写口**——供那条外部流程
 *   在真正删完文件层之后调用，本 feature 自己不会调用它。
 */
import type { ConsentKeyValue } from "./consent-token-ports";
import type { WithdrawalStepRecord } from "../../domain/interview/withdrawal";

export type WithdrawalOriginValue = "portal" | "staff-assisted";

/* ─────────────────────────── 撤回单据 ─────────────────────────── */

export interface WithdrawalRecord {
  readonly withdrawalId: string;
  readonly subjectId: string;
  readonly scope: readonly ConsentKeyValue[];
  readonly reason: string | null;
  readonly origin: WithdrawalOriginValue;
  readonly queuedAt: Date;
  readonly steps: readonly WithdrawalStepRecord[];
  /** 第 05 步真正完成的时刻——由 `markPhysicalDeleteComplete` 写入，本 feature 自己不写。 */
  readonly physicalDeleteCompletedAt: Date | null;
  readonly receiptId: string | null;
}

export interface CreateWithdrawalInput {
  readonly withdrawalId: string;
  readonly subjectId: string;
  readonly scope: readonly ConsentKeyValue[];
  readonly reason: string | null;
  readonly origin: WithdrawalOriginValue;
  readonly queuedAt: Date;
  readonly steps: readonly WithdrawalStepRecord[];
}

export interface WithdrawalRepository {
  /**
   * 幂等/冲突判定的唯一入口：同一 `subjectId` 且 `scope` 有交集、且第 05 步尚未完成的
   * 在途撤回视为 `WITHDRAWAL_IN_PROGRESS`——与 `withdraw-participant-phone.ts`（F14）
   * 「不同请求对同一目标的冲突声明」同一读法，这里不做"同一请求重放"的幂等豁免，
   * 因为撤回没有一个天然的"请求指纹"可判重放（受访者可能真的连点两次，也可能是
   * 两个不同渠道各发起一次）——两种都先挡下来，比允许重复入队更安全。
   */
  findActiveForSubject(
    subjectId: string,
    scope: readonly ConsentKeyValue[],
  ): Promise<WithdrawalRecord | null>;
  create(input: CreateWithdrawalInput): Promise<WithdrawalRecord>;
  findById(withdrawalId: string): Promise<WithdrawalRecord | null>;
  /** 外部（22-files/17-gov）在物理删除真正完成后回写。本 feature 自身不调用。 */
  markPhysicalDeleteComplete(withdrawalId: string, at: Date): Promise<WithdrawalRecord | null>;
  saveReceipt(withdrawalId: string, receiptId: string): Promise<void>;
}

export const WITHDRAWAL_REPOSITORY = Symbol("WithdrawalRepository");

/* ─────────────────────────── 定位受影响片段 ─────────────────────────── */

export interface WithdrawalSegmentLocator {
  /** 该受访者、按撤回范围（scope）圈定的片段 id 集合——只撤部分同意位时只圈对应片段。 */
  segmentIdsFor(subjectId: string, scope: readonly ConsentKeyValue[]): Promise<readonly string[]>;
}

export const WITHDRAWAL_SEGMENT_LOCATOR = Symbol("WithdrawalSegmentLocator");

/* ─────────────────────────── 第 02 步：检索退出 + 主题矩阵重算 ─────────────────────────── */

export interface RetrievalExclusionPort {
  /** 片段**立即退出检索范围**——不是排序靠后，检索结果里不存在（R4/A4）。 */
  exclude(segmentIds: readonly string[], at: Date): Promise<void>;
  /** 该受访者所在主题矩阵格子的强度重算（R4/A4 第 02 步）。 */
  recomputeTopicMatrixStrength(subjectId: string): Promise<void>;
}

export const RETRIEVAL_EXCLUSION_PORT = Symbol("RetrievalExclusionPort");

/* ─────────────────────────── 第 03 步：报告段落标失效 + D-19 对外确认 ─────────────────────────── */

export interface ReportSegmentRef {
  readonly kind: string;
  readonly id: string;
  /** 已发布给客户的对外产出——D-19 要求这一类**不自动改写**，只能标内部失效 + 排队待人工确认替换。 */
  readonly published: boolean;
}

export interface ReportSegmentAnnotator {
  listReferencing(segmentIds: readonly string[]): Promise<readonly ReportSegmentRef[]>;
  /**
   * 标「证据已撤回」——**不删除段落**（R4/A4 第 03 步）。对 `published: true` 的引用，
   * 这一步仍然只做**对内**标记；对外真正替换走 `queuePendingExternalConfirmation`，
   * 由人工确认后触发，不在本方法内发生（D-19：两个方向都禁止静默）。
   */
  markEvidenceWithdrawn(segmentIds: readonly string[], at: Date): Promise<readonly ReportSegmentRef[]>;
  /** 对已发布引用登记一条「待人工确认后替换」的任务——本 feature 只登记，不自动替换。 */
  queuePendingExternalConfirmation(refs: readonly ReportSegmentRef[]): Promise<readonly string[]>;
}

export const REPORT_SEGMENT_ANNOTATOR = Symbol("ReportSegmentAnnotator");

/* ─────────────────────────── 第 04 步：已签字决策复核 ─────────────────────────── */

export interface SignedDecisionRef {
  readonly decisionId: string;
  readonly approverId: string;
}

export interface SignedDecisionReviewNotifier {
  /** 以这些片段为证据、且已签字的决策——本用例只找出来，不触碰其结论（R6/A4 第 04 步）。 */
  findSignedDecisionsSupportedBy(segmentIds: readonly string[]): Promise<readonly SignedDecisionRef[]>;
  /** 给拍板人生成一条复核任务，返回 taskId——**不改结论**，只是让人知道要复核。 */
  createReviewTask(input: {
    readonly decisionId: string;
    readonly approverId: string;
    readonly withdrawalId: string;
    readonly segmentIds: readonly string[];
  }): Promise<string>;
}

export const SIGNED_DECISION_REVIEW_NOTIFIER = Symbol("SignedDecisionReviewNotifier");

/* ─────────────────────────── 级联失效：派生物 + Claim ─────────────────────────── */

export type WithdrawalDerivativeKind = "ocr" | "embedding" | "graph-edge" | "summary" | "cache";

export interface WithdrawalDerivativeRef {
  readonly id: string;
  readonly kind: WithdrawalDerivativeKind;
}

export interface CascadeInvalidationStore {
  /** 以这些片段为输入的全部派生物——OCR / embedding（含声纹）/ 图边 / 摘要 / 缓存。 */
  listDerivatives(segmentIds: readonly string[]): Promise<readonly WithdrawalDerivativeRef[]>;
  /** 失效，不是物理删除——`context_packs` 历史快照要保留但标注来源已失效，见 V7b④。 */
  invalidate(derivativeIds: readonly string[], at: Date): Promise<void>;
  /** 以这些片段为**唯一**证据的 Claim——判定"唯一"是本端口实现的职责（domain 不重写一遍）。 */
  listClaimsSolelyEvidencedBy(segmentIds: readonly string[]): Promise<readonly string[]>;
  /** 转 `contested`（V7b③），不得继续以「已验证」呈现。 */
  markClaimsContested(claimIds: readonly string[]): Promise<void>;
}

export const CASCADE_INVALIDATION_STORE = Symbol("CascadeInvalidationStore");

/* ─────────────────────────── 第 01/05 步：待删除队列 ─────────────────────────── */

export interface PendingDeletionQueue {
  /** 入队（第 01 步，即时）。本 feature 不执行物理删除，只入队触发。 */
  enqueue(input: {
    readonly withdrawalId: string;
    readonly subjectId: string;
    readonly scope: readonly ConsentKeyValue[];
    readonly segmentIds: readonly string[];
    readonly dueAt: Date;
  }): Promise<{ readonly ticketId: string }>;
}

export const PENDING_DELETION_QUEUE = Symbol("PendingDeletionQueue");
