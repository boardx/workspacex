/**
 * `listFeedbackEvents` —— 一条反馈的完整状态流水（含每一步"有没有真的发邮件通知
 * 提交人、发的是什么"）。给后台看板的 detail 弹层用（人类原话：邮件的 update
 * 需要可以在 detail 的界面看到）。
 *
 * ## 为什么权限判定只有 `canTriage`，不是 D3 那套（管理员 OR 提交人）
 *
 * 这条历史里混着**谁经手过**（`actorId`）——一个管理员的操作记录不该暴露给
 * 提交人看("谁在什么时候点了哪个按钮")，D3 只裁决了反馈**正文**要不要给提交人看，
 * 从没裁决过分诊历史。所以这里复用 `triageFeedback` 同一条权限判定（组织管理员），
 * 不是新造一套，也不放宽到提交人——现在唯一的调用方（后台看板 detail 弹层）本来
 * 就只有管理员能打开。
 *
 * ⚠ `FeedbackNotFoundError` 同时覆盖"不存在"与"不可见"，与 `triageFeedback`/
 *   `getFeedbackGithubIssue` 同一条纪律（404 非 403，不泄露存在性）。
 */
import { canTriage } from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "./triage-feedback";
import type { ProductFeedbackRepository, StatusEventRow } from "./ports";

export interface ListFeedbackEventsDeps {
  readonly repo: ProductFeedbackRepository;
}

export interface ListFeedbackEventsInput {
  readonly feedbackId: string;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
}

export async function listFeedbackEvents(
  deps: ListFeedbackEventsDeps,
  input: ListFeedbackEventsInput,
): Promise<readonly StatusEventRow[]> {
  if (!canTriage(input.actorOrgRole)) throw new FeedbackTriageForbiddenError();

  // 存在性/可见性先判——与 `triageFeedback` 同一条顺序纪律（权限先判,仓储后动
  // 这条已经在上面;这里是"资源存在性"这一半:一条别的租户的 feedbackId 必须
  // 读成 404,不能读出一份跨租户的流水)。
  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();

  return deps.repo.listStatusEvents(input.feedbackId);
}
