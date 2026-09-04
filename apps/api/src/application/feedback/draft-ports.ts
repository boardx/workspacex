/**
 * UC-17.8 B1 —— 反馈草稿的仓储端口。与 `ports.ts`（反馈本身）分开，理由同契约 `FeedbackDraft`
 * 头注：草稿与反馈是**两个类型**，没有状态机、没有票、没有 D3——把它们塞进同一个仓储接口
 * 会让每个方法都要解释「草稿时这个是什么意思」。
 *
 * ## owner 规则在哪里
 *
 * 每个读/写方法都**必须**接 `ownerId`，且实现把它写进 SQL 谓词（`owner_id = $n`），不是先
 * 查出来再在应用层比对——两步之间没有窗口可言（草稿只有 owner 会碰），但「读出来再比」意味着
 * 一条忘了比的路径会把别人的草稿整行交出去。见迁移 `20260904130100_uc178_feedback_drafts.sql`
 * 头注与 `tests/feedback/draft-repository-guard.test.ts`。
 *
 * ⚠ 仓储按组织构造（`forOrg`），同 `ProductFeedbackRepositoryFactory` 的理由。
 */
import type { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import type { FeedbackKind, FeedbackStructured, FeedbackTarget } from "./ports";

export const FEEDBACK_DRAFT_REPOSITORY = Symbol("FeedbackDraftRepository");

/** 一条对话记录，形状只在契约里声明一次。 */
export type FeedbackDraftChatTurn = z.infer<typeof feedbackLoop.FeedbackDraftChatTurn>;

export interface FeedbackDraftRow {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly detail: string;
  readonly structured: FeedbackStructured | null;
  readonly chat: readonly FeedbackDraftChatTurn[];
  readonly refineSeeded: boolean;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewFeedbackDraft {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly detail: string;
  readonly structured: FeedbackStructured | null;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
}

/**
 * `update` 的补丁：只带要改的字段。`chat` 是**整个新数组**——追加逻辑（含 seed 问题与固定
 * 回执）在用例层算好再整体写回，仓储不知道什么是「回执」。
 */
export interface FeedbackDraftPatch {
  readonly kind?: FeedbackKind;
  readonly detail?: string;
  readonly structured?: FeedbackStructured | null;
  readonly chat?: readonly FeedbackDraftChatTurn[];
  readonly refineSeeded?: boolean;
}

export interface FeedbackDraftRepository {
  create(draft: NewFeedbackDraft): Promise<void>;
  /** 按 `updatedAt` 倒序（契约 `listMyFeedbackDrafts`）。 */
  listMine(ownerId: string): Promise<readonly FeedbackDraftRow[]>;
  countMine(ownerId: string): Promise<number>;
  /** 不存在**或不是 ownerId 的** ⇒ `null`（契约 `DRAFT_NOT_FOUND`：同 404 非 403 纪律）。 */
  get(draftId: string, ownerId: string): Promise<FeedbackDraftRow | null>;
  /** 一条 UPDATE，`updated_at = now()`。返回更新后的行；不存在/不是 owner ⇒ `null`。 */
  update(draftId: string, ownerId: string, patch: FeedbackDraftPatch): Promise<FeedbackDraftRow | null>;
  /** 硬删。返回是否真的删了一行（不存在/不是 owner ⇒ `false`）。 */
  delete(draftId: string, ownerId: string): Promise<boolean>;
}

export interface FeedbackDraftRepositoryFactory {
  forOrg(orgId: string): FeedbackDraftRepository;
}
