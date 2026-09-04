/**
 * UC-17.8 B1 —— 草稿六条用例的闭环：创建 → 列出 → 改 → 追加对话（seed 只一次、固定回执）
 * → 提交（空正文拒绝 / 成功后草稿消失、反馈存在、附件迁移）→ 删除（附件回到未认领）。
 * 纯内存 fake，不连库——owner 谓词与 RLS 由 `draft-repository-guard.test.ts` + 迁移守。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { createFeedbackDraft } from "../../src/application/feedback/drafts/create-feedback-draft";
import { listMyFeedbackDrafts } from "../../src/application/feedback/drafts/list-my-feedback-drafts";
import { countMyFeedbackDrafts } from "../../src/application/feedback/drafts/count-my-feedback-drafts";
import { REFINE_ACK, REFINE_SEED_QUESTION, updateFeedbackDraft } from "../../src/application/feedback/drafts/update-feedback-draft";
import { deleteFeedbackDraft } from "../../src/application/feedback/drafts/delete-feedback-draft";
import { submitFeedbackDraft } from "../../src/application/feedback/drafts/submit-feedback-draft";
import { FeedbackDraftEmptyError, FeedbackDraftNotFoundError } from "../../src/application/feedback/drafts/draft-shared";
import { FakeAttachmentRepo, FakeDraftRepo, fakeFeedbackRepo } from "./draft-fakes";

const ORG = toOrgId("org-1");
const ME = "u-me";
const OTHER = "u-other";

function world() {
  const drafts = new FakeDraftRepo();
  const attachments = new FakeAttachmentRepo();
  let n = 0;
  const base = { drafts, attachments, orgId: ORG };
  const createDeps = { ...base, newDraftId: () => `d-${++n}` };
  const clock = { t: 0 };
  const updateDeps = { ...base, now: () => new Date(Date.UTC(2026, 8, 4, 12, 0, ++clock.t)) };
  return { drafts, attachments, base, createDeps, updateDeps };
}

describe("UC-17.8 B1 草稿闭环", () => {
  it("创建 → 列出（含派生标题 / 附件）→ 计数；别人看不到", async () => {
    const w = world();
    w.attachments.seed("a-1", ME);
    const { draftId } = await createFeedbackDraft(w.createDeps, {
      ownerId: ME, kind: "缺陷", target: { kind: "product" },
      detail: "导出按钮点了没反应。第二次点也没反应",
      occurredRoute: "/chat", appVersion: "1.0", attachmentIds: ["a-1"],
    });
    expect(draftId).toBe("d-1");
    const mine = await listMyFeedbackDrafts(w.base, { ownerId: ME });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: "d-1", title: "导出按钮点了没反应", detail: "导出按钮点了没反应。第二次点也没反应",
      structured: null, chat: [], refineSeeded: false,
      attachments: [{ id: "a-1", url: "/feedback/attachments/a-1", mime: "image/png" }],
    });
    expect(await countMyFeedbackDrafts({ drafts: w.drafts }, { ownerId: ME })).toEqual({ count: 1 });
    expect(await listMyFeedbackDrafts(w.base, { ownerId: OTHER })).toEqual([]);
    expect(await countMyFeedbackDrafts({ drafts: w.drafts }, { ownerId: OTHER })).toEqual({ count: 0 });
  });

  it("空正文草稿可以建，title 为 null", async () => {
    const w = world();
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "需求", target: { kind: "product" }, detail: "   ", occurredRoute: null, appVersion: null });
    const [d] = await listMyFeedbackDrafts(w.base, { ownerId: ME });
    expect(d!.title).toBeNull();
  });

  it("改正文 ⇒ 追加一条 edit 记录（不覆盖）；相同正文不追加；四个字段都不传是空操作", async () => {
    const w = world();
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: "v1", occurredRoute: null, appVersion: null });
    let r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, detail: "v2", kind: "需求", structured: { useScenario: "开会时" } });
    expect(r.draft.kind).toBe("需求");
    expect(r.draft.detail).toBe("v2");
    expect(r.draft.structured).toEqual({ useScenario: "开会时" });
    expect(r.draft.chat).toEqual([{ role: "user", kind: "edit", text: "v2", at: "2026-09-04T12:00:01.000Z" }]);
    r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, detail: "v2" });
    expect(r.draft.chat).toHaveLength(1);
    r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME });
    expect(r.draft.chat).toHaveLength(1);
    // structured 显式置 null 生效
    r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, structured: null });
    expect(r.draft.structured).toBeNull();
  });

  it("追加对话：首次 seed 一条固定 AI 澄清问题（只一次），用户消息之后追加固定回执", async () => {
    const w = world();
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: "v1", occurredRoute: null, appVersion: null });
    let r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, appendChat: { role: "user", kind: "message", text: "只影响导出" } });
    expect(r.draft.refineSeeded).toBe(true);
    expect(r.draft.chat.map((c) => [c.role, c.kind, c.text])).toEqual([
      ["ai", "message", REFINE_SEED_QUESTION],
      ["user", "message", "只影响导出"],
      ["ai", "message", REFINE_ACK],
    ]);
    r = await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, appendChat: { role: "user", kind: "message", text: "P1" } });
    const texts = r.draft.chat.map((c) => c.text);
    expect(texts.filter((t) => t === REFINE_SEED_QUESTION)).toHaveLength(1);
    expect(texts.slice(-2)).toEqual(["P1", REFINE_ACK]);
    // `at` 由服务端给，客户端的 appendChat 里没有它
    expect(r.draft.chat.every((c) => typeof c.at === "string" && c.at.endsWith("Z"))).toBe(true);
  });

  it("改/删/提交别人的草稿 ⇒ DRAFT_NOT_FOUND（同 404 非 403）", async () => {
    const w = world();
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: "v1", occurredRoute: null, appVersion: null });
    await expect(updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: OTHER, detail: "x" })).rejects.toBeInstanceOf(FeedbackDraftNotFoundError);
    await expect(deleteFeedbackDraft(w.base, { draftId: "d-1", ownerId: OTHER })).rejects.toBeInstanceOf(FeedbackDraftNotFoundError);
    const fb = fakeFeedbackRepo();
    await expect(submitFeedbackDraft({ ...w.base, submit: { repo: fb.repo, newFeedbackId: () => "fb-1", newEventId: () => "ev-1" } }, { draftId: "d-1", ownerId: OTHER }))
      .rejects.toBeInstanceOf(FeedbackDraftNotFoundError);
    expect(w.drafts.rows.size).toBe(1);
  });

  it("提交：空正文 ⇒ DRAFT_EMPTY，草稿保留、没建反馈", async () => {
    const w = world();
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: " \n ", occurredRoute: null, appVersion: null });
    const fb = fakeFeedbackRepo();
    await expect(submitFeedbackDraft({ ...w.base, submit: { repo: fb.repo, newFeedbackId: () => "fb-1", newEventId: () => "ev-1" } }, { draftId: "d-1", ownerId: ME }))
      .rejects.toBeInstanceOf(FeedbackDraftEmptyError);
    expect(fb.inserted).toEqual([]);
    expect(w.drafts.rows.has("d-1")).toBe(true);
  });

  it("提交成功：复用 submitFeedback（标题服务端派生、结构化字段随行、创建事件）→ 附件迁到反馈 → 草稿消失", async () => {
    const w = world();
    w.attachments.seed("a-1", ME);
    w.attachments.seed("a-2", ME, "application/pdf");
    await createFeedbackDraft(w.createDeps, {
      ownerId: ME, kind: "缺陷", target: { kind: "skill", skillId: "s-1" },
      detail: "  导出 PDF 会卡住！每次都这样\n第二行", structured: { reproSteps: "1. 点导出" },
      occurredRoute: "/chat", appVersion: "1.0", attachmentIds: ["a-1", "a-2"],
    });
    await updateFeedbackDraft(w.updateDeps, { draftId: "d-1", ownerId: ME, appendChat: { role: "user", kind: "message", text: "对话不进正文" } });
    const fb = fakeFeedbackRepo();
    const out = await submitFeedbackDraft(
      { ...w.base, submit: { repo: fb.repo, attachments: w.attachments, newFeedbackId: () => "fb-1", newEventId: () => "ev-1" } },
      { draftId: "d-1", ownerId: ME },
    );
    expect(out).toEqual({ feedbackId: "fb-1", status: "待处理" });
    expect(fb.inserted).toEqual([{
      id: "fb-1", submittedBy: ME, kind: "缺陷", target: { kind: "skill", skillId: "s-1" }, targetLabel: null,
      title: "导出 PDF 会卡住", detail: "导出 PDF 会卡住！每次都这样\n第二行",
      structured: { reproSteps: "1. 点导出" }, occurredRoute: "/chat", appVersion: "1.0",
    }]);
    expect(fb.events[0]).toMatchObject({ id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", actorId: ME });
    expect(w.drafts.rows.has("d-1")).toBe(false);
    expect(w.attachments.rows.get("a-1")).toMatchObject({ feedbackId: "fb-1", draftId: null });
    expect(w.attachments.rows.get("a-2")).toMatchObject({ feedbackId: "fb-1", draftId: null });
    expect(await listMyFeedbackDrafts(w.base, { ownerId: ME })).toEqual([]);
  });

  it("删除：附件回到未认领，草稿消失", async () => {
    const w = world();
    w.attachments.seed("a-1", ME);
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: "v1", occurredRoute: null, appVersion: null, attachmentIds: ["a-1"] });
    expect(w.attachments.rows.get("a-1")!.draftId).toBe("d-1");
    expect(await deleteFeedbackDraft(w.base, { draftId: "d-1", ownerId: ME })).toEqual({ draftId: "d-1" });
    expect(w.drafts.rows.size).toBe(0);
    expect(w.attachments.rows.get("a-1")).toMatchObject({ feedbackId: null, draftId: null });
  });

  it("第 6 个附件：契约拒（max 5）；用例层最多挂 5 个", async () => {
    const { feedbackLoop } = await import("@repo/contracts");
    const ids = ["a-1", "a-2", "a-3", "a-4", "a-5", "a-6"];
    expect(feedbackLoop.operations.createFeedbackDraft.in.safeParse({
      kind: "缺陷", target: { kind: "product" }, detail: "x", occurredRoute: null, appVersion: null, attachmentIds: ids,
    }).success).toBe(false);
    expect(feedbackLoop.operations.submitFeedback.in.safeParse({
      kind: "缺陷", target: { kind: "product" }, title: "x", detail: "x", occurredRoute: null, appVersion: null, attachmentIds: ids,
    }).success).toBe(false);
    const w = world();
    for (const id of ids) w.attachments.seed(id, ME);
    await createFeedbackDraft(w.createDeps, { ownerId: ME, kind: "缺陷", target: { kind: "product" }, detail: "v1", occurredRoute: null, appVersion: null, attachmentIds: ids });
    expect([...w.attachments.rows.values()].filter((r) => r.draftId === "d-1")).toHaveLength(5);
    expect(w.attachments.rows.get("a-6")!.draftId).toBeNull();
  });
});
