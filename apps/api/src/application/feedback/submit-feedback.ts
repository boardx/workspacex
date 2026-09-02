/**
 * `submitFeedback` —— 提交一条反馈的**唯一用例**（FB-2）。
 *
 * 导航栏弹层与 chat 内的 agent/skill 反馈按钮走的是**同一条**路径，
 * 差别只在 `target`。两个入口各写一条用例的话，「反馈从哪来」这件事会立刻
 * 长出两套状态初值、两套上下文采集规则，而它们不会同时被改。
 *
 * ⚠ 状态恒从 `待处理` 起步，**不接受入参**。让客户端传初始状态，
 *   等于让任何人把自己的反馈直接标成「已修复」。
 *
 * ⚠ 创建时**写一条 `from = null` 的 status event**。少了它，一条从未被分诊过的反馈
 *   在状态流水里是空的，而「空」同时意味着「没人管过」和「这条不存在」——
 *   查「为什么我提的那条一直没动静」时，这两者必须分得开。
 */
import type { NewFeedback, ProductFeedbackRepository } from "./ports";

export interface SubmitFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  readonly newFeedbackId: () => string;
  readonly newEventId: () => string;
}

export interface SubmitFeedbackResult {
  readonly feedbackId: string;
  readonly status: "待处理";
}

export async function submitFeedback(
  deps: SubmitFeedbackDeps,
  input: Omit<NewFeedback, "id">,
): Promise<SubmitFeedbackResult> {
  const feedbackId = deps.newFeedbackId();
  await deps.repo.insert({ ...input, id: feedbackId });
  await deps.repo.appendStatusEvent({
    id: deps.newEventId(),
    feedbackId,
    fromStatus: null,
    toStatus: "待处理",
    reason: null,
    actorId: input.submittedBy,
    // 提交这一步不发通知邮件——提交人当然知道自己刚提交了什么,通知是"状态**变了**"
    // 那一刻才有意义的事。见 `triage-feedback.ts`.notifySubmitter 的对称逻辑。
    notified: false,
    emailSubject: null,
    emailText: null,
  });
  return { feedbackId, status: "待处理" };
}
