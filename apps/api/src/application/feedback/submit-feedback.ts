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
 *
 * ## FB-5（2026-09-02）：认领图片附件是 best-effort，不阻塞反馈提交本身
 *
 * `attachmentIds` 是**已经上传过**的附件 id（`uploadFeedbackAttachment` 先落库、
 * `feedback_id IS NULL`）。反馈本身插入成功之后才认领——先有反馈这行、附件才有
 * 挂靠的对象。认领失败（id 不是这个人上传的 / 已被别的反馈认领 / 根本不存在）
 * **不影响反馈提交成功**：反馈的文字才是这次提交的核心事实，图片是锦上添花，
 * 与状态变更邮件、GitHub issue 状态同步同一条"次要副作用 best-effort"纪律。
 * `attachments` 未注入或 `attachmentIds` 为空/未传时，这一步完全跳过，行为与
 * FB-5 之前逐字节相同。
 *
 * ## 2026-09-02（人类要求）：提交成功后给提交人发一封确认邮件，best-effort
 *
 * 与 `triage-feedback.ts` 的 `notifySubmitter` 同一条纪律：反馈行 + 创建事件先落库，
 * **之后**才发邮件；发出去了就把主题/正文回填到那条创建事件上（`markStatusEventNotified`），
 * 后台「动态」里于是能看到"已邮件通知提交人 + 发了什么"。任何一步失败只记日志，
 * 提交本身已经成功——用户不会因为邮件服务抖动而被告知"没提交上"。
 * `submitterDirectory` / `mail` 两个依赖都未注入时整段跳过（旧调用路径 / 测试）。
 */
import type { OrgId } from "../../domain/org-id";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import type { FeedbackAttachmentRepository } from "./attachment-ports";
import type { FeedbackSubmitterDirectory } from "./notification-ports";
import type { FeedbackKind, NewFeedback, ProductFeedbackRepository } from "./ports";

export interface SubmitFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  readonly newFeedbackId: () => string;
  readonly newEventId: () => string;
  /** 未注入 = 这次部署/这条调用路径不处理附件认领，行为与 FB-5 之前逐字节相同。 */
  readonly attachments?: FeedbackAttachmentRepository;
  /** 两个都注入才发确认邮件——见文件头。 */
  readonly submitterDirectory?: FeedbackSubmitterDirectory;
  readonly mail?: TransactionalMailTransport;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

/** 确认邮件的文案——同 `triage-feedback.ts` 的 `statusChangeEmail`，纯函数方便单测直接断言。 */
export function submissionReceivedEmail(input: {
  readonly kind: FeedbackKind;
  readonly title: string;
}): { readonly subject: string; readonly text: string } {
  const noun = input.kind === "需求" ? "需求" : "反馈";
  return {
    subject: `已收到你的${noun}《${input.title}》`,
    text: [
      `你提交的${noun}《${input.title}》我们已经收到，当前状态「待处理」。`,
      "有进展会再邮件通知你；也可以随时在产品里点「反馈」→「我提过的」查看状态与处理说明。",
    ].join("\n"),
  };
}

export interface SubmitFeedbackInput extends Omit<NewFeedback, "id"> {
  readonly orgId?: OrgId;
  /** 提交前已上传的图片附件 id 列表——见文件头注。缺省/空 = 不带附件。 */
  readonly attachmentIds?: readonly string[];
}

export interface SubmitFeedbackResult {
  readonly feedbackId: string;
  readonly status: "待处理";
}

export async function submitFeedback(
  deps: SubmitFeedbackDeps,
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  const { orgId, attachmentIds, ...record } = input;
  const feedbackId = deps.newFeedbackId();
  const eventId = deps.newEventId();
  await deps.repo.insert({ ...record, id: feedbackId });
  await deps.repo.appendStatusEvent({
    id: eventId,
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

  if (deps.attachments !== undefined && orgId !== undefined && attachmentIds !== undefined && attachmentIds.length > 0) {
    try {
      const claimed = await deps.attachments.claimForFeedback(orgId, feedbackId, attachmentIds, input.submittedBy);
      if (claimed !== attachmentIds.length) {
        deps.log?.("feedback submit: some attachments failed to claim (not fatal)", {
          feedbackId,
          requested: attachmentIds.length,
          claimed,
        });
      }
    } catch (e) {
      deps.log?.("feedback submit: attachment claim failed (best-effort, feedback already committed)", {
        feedbackId,
        err: e,
      });
    }
  }

  await sendSubmissionConfirmation(deps, { feedbackId, eventId, submittedBy: input.submittedBy, kind: input.kind, title: input.title });

  return { feedbackId, status: "待处理" };
}

async function sendSubmissionConfirmation(
  deps: SubmitFeedbackDeps,
  input: { readonly feedbackId: string; readonly eventId: string; readonly submittedBy: string; readonly kind: FeedbackKind; readonly title: string },
): Promise<void> {
  if (deps.submitterDirectory === undefined || deps.mail === undefined) return;
  try {
    const email = await deps.submitterDirectory.emailForUserId(input.submittedBy);
    if (email === null) {
      deps.log?.("feedback submit: submitter has no resolvable email, skipping confirmation", { feedbackId: input.feedbackId });
      return;
    }
    const { subject, text } = submissionReceivedEmail(input);
    await deps.mail.send({ to: email, subject, text });
    // 发出去了才回填——`notified: true` 必须带主题/正文快照（迁移 20260902150000 的约束）。
    await deps.repo.markStatusEventNotified(input.eventId, true, subject, text);
  } catch (e) {
    deps.log?.("feedback submit: confirmation email failed (best-effort, feedback already committed)", {
      feedbackId: input.feedbackId,
      err: e,
    });
  }
}
