/**
 * 2026-09-02——提交反馈后的确认邮件（best-effort，见 `submit-feedback.ts` 头注）。
 *
 *   ① 提交人有邮箱 ⇒ 发一封「已收到」，并把主题/正文回填到创建事件上（`notified: true`）。
 *   ② 邮件失败 ⇒ 提交仍然成功，创建事件保持 `notified: false`，不回填。
 *   ③ 查不到邮箱 / 没注入邮件依赖 ⇒ 不发、不回填、不报错。
 */
import { describe, expect, it, vi } from "vitest";
import { submitFeedback, submissionReceivedEmail, type SubmitFeedbackDeps } from "../../src/application/feedback/submit-feedback";
import type { ProductFeedbackRepository } from "../../src/application/feedback/ports";

function fakeRepo(): ProductFeedbackRepository {
  return {
    insert: vi.fn(async () => {}),
    appendStatusEvent: vi.fn(async () => {}),
    markStatusEventNotified: vi.fn(async () => {}),
  } as unknown as ProductFeedbackRepository;
}

function deps(over: Partial<SubmitFeedbackDeps> = {}): SubmitFeedbackDeps {
  return {
    repo: fakeRepo(),
    newFeedbackId: () => "fb-1",
    newEventId: () => "ev-1",
    submitterDirectory: { emailForUserId: vi.fn(async () => "me@example.com"), displayNamesForUserIds: vi.fn(async () => new Map()) },
    mail: { send: vi.fn(async () => ({})) },
    log: vi.fn(),
    ...over,
  } as SubmitFeedbackDeps;
}

const input = {
  submittedBy: "u-1", kind: "需求" as const, target: { kind: "product" as const }, targetLabel: null,
  title: "导出 Markdown", detail: "方便整理", occurredRoute: "/chat", appVersion: null,
};

describe("submitFeedback 确认邮件", () => {
  it("① 有邮箱 ⇒ 发「已收到」并回填到创建事件", async () => {
    const d = deps();
    const out = await submitFeedback(d, input);
    expect(out).toEqual({ feedbackId: "fb-1", status: "待处理" });
    const { subject, text } = submissionReceivedEmail({ kind: "需求", title: "导出 Markdown" });
    expect(subject).toBe("已收到你的需求《导出 Markdown》");
    expect(d.mail!.send).toHaveBeenCalledWith({ to: "me@example.com", subject, text });
    expect(d.repo.markStatusEventNotified).toHaveBeenCalledWith("ev-1", true, subject, text);
    // 创建事件本身仍以 notified:false 插入——邮件是落库之后才发的。
    expect(d.repo.appendStatusEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "ev-1", notified: false, emailSubject: null, emailText: null }));
  });

  it("② 邮件失败 ⇒ 提交仍成功，不回填，只记日志", async () => {
    const d = deps({ mail: { send: vi.fn(async () => { throw new Error("smtp down"); }) } });
    await expect(submitFeedback(d, input)).resolves.toEqual({ feedbackId: "fb-1", status: "待处理" });
    expect(d.repo.markStatusEventNotified).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("confirmation email failed"), expect.objectContaining({ feedbackId: "fb-1" }));
  });

  it("③ 查不到邮箱 / 没注入依赖 ⇒ 不发不回填", async () => {
    const noEmail = deps({ submitterDirectory: { emailForUserId: vi.fn(async () => null), displayNamesForUserIds: vi.fn(async () => new Map()) } });
    await submitFeedback(noEmail, input);
    expect(noEmail.mail!.send).not.toHaveBeenCalled();
    expect(noEmail.repo.markStatusEventNotified).not.toHaveBeenCalled();

    const bare = deps({ submitterDirectory: undefined, mail: undefined });
    await submitFeedback(bare, input);
    expect(bare.repo.markStatusEventNotified).not.toHaveBeenCalled();
  });

  it("缺陷的措辞是「反馈」", () => {
    expect(submissionReceivedEmail({ kind: "缺陷", title: "点了没反应" }).subject).toBe("已收到你的反馈《点了没反应》");
  });
});
