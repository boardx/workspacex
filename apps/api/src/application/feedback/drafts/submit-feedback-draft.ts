/**
 * `submitFeedbackDraft`（UC-17.8 B1）—— 把草稿提交成一条反馈：
 * **建反馈（复用 `submitFeedback` 全部规则）→ 附件改挂到反馈 → 删草稿**。
 *
 * ## 事务边界（诚实版）
 *
 * 契约头注写「事务内」。本仓的仓储端口是「每个方法恰好一次 `withTenant`（= 一次事务）」，
 * `submitFeedback` 用例本身就是 insert + 创建事件两次独立事务，跨仓储没有共享 session 的
 * 端口形状——为了原子性把它的落库/事件/邮件逻辑复制到一个大事务里，正是任务明令禁止的
 * 「不要复制它的落库/事件/邮件逻辑」。所以这里的边界是**三步顺序执行、每步各自原子**，
 * 且顺序保证失败时系统处在一个**可恢复、无悬空引用**的状态：
 *
 *   ① `submitFeedback` —— 反馈落库（这一步失败 ⇒ 什么都没发生，草稿原样）。
 *   ② `moveDraftAttachmentsToFeedback` —— 一条 UPDATE，草稿上的附件整体改挂到反馈
 *      （失败 ⇒ 反馈已存在但没图，草稿仍在且仍带附件；用户看到两条，删草稿即可。记日志）。
 *   ③ `drafts.delete` —— 删草稿（失败 ⇒ 反馈完整，留一条空附件的草稿；同上）。
 *
 * ② ③ 都不会让反馈少任何东西；最坏情况是多一条草稿。反过来的顺序（先删草稿）会让附件
 * 在 FK `ON DELETE SET NULL` 下先回到未认领、再也迁不到反馈上——那才是丢数据。
 *
 * ## 标题、正文、结构化字段
 *
 *   · 正文 = `detail` 当前值，trim 为空 ⇒ `DRAFT_EMPTY`（`submitFeedback.in.detail.min(1)` 的语义）。
 *   · 标题由 `deriveFeedbackTitle`（服务端权威）派生；正文非空 ⇒ 标题必然非空。
 *   · 对话记录**不进正文**（契约头注逐字）。
 *   · `attachmentIds` **不传**给 `submitFeedback`——附件已经挂在草稿上，由 ② 整体迁移；
 *     再传一次会让 `claimForFeedback` 去认领一批 `draft_id IS NOT NULL` 的行，恒 0，只会多一行日志。
 */
import { deriveFeedbackTitle } from "../../../domain/feedback/derive-feedback-title";
import { submitFeedback, type SubmitFeedbackDeps, type SubmitFeedbackResult } from "../submit-feedback";
import { FeedbackDraftEmptyError, FeedbackDraftNotFoundError, type FeedbackDraftDeps } from "./draft-shared";

export interface SubmitFeedbackDraftDeps extends FeedbackDraftDeps {
  /** 完整的 `submitFeedback` 依赖——邮件 / 事件 / 日志全部沿用，这里不复制任何一条。 */
  readonly submit: SubmitFeedbackDeps;
}

export async function submitFeedbackDraft(
  deps: SubmitFeedbackDraftDeps,
  input: { readonly draftId: string; readonly ownerId: string },
): Promise<SubmitFeedbackResult> {
  const draft = await deps.drafts.get(input.draftId, input.ownerId);
  if (draft === null) throw new FeedbackDraftNotFoundError();
  const detail = draft.detail.trim();
  const title = deriveFeedbackTitle(detail);
  if (detail === "" || title === null) throw new FeedbackDraftEmptyError();

  const result = await submitFeedback(deps.submit, {
    submittedBy: input.ownerId,
    orgId: deps.orgId,
    kind: draft.kind,
    target: draft.target,
    targetLabel: null,
    title,
    detail,
    structured: draft.structured,
    occurredRoute: draft.occurredRoute,
    appVersion: draft.appVersion,
  });

  const log = deps.submit.log;
  try {
    await deps.attachments.moveDraftAttachmentsToFeedback(deps.orgId, input.draftId, result.feedbackId);
  } catch (e) {
    log?.("feedback draft submit: attachment move failed (feedback already committed, draft kept)", {
      draftId: input.draftId,
      feedbackId: result.feedbackId,
      err: e,
    });
    return result;
  }
  try {
    await deps.drafts.delete(input.draftId, input.ownerId);
  } catch (e) {
    log?.("feedback draft submit: draft delete failed (feedback already committed)", {
      draftId: input.draftId,
      feedbackId: result.feedbackId,
      err: e,
    });
  }
  return result;
}
