/**
 * UC-17.8 B4.3 —— 六个设计项目用例的正反例，全部用内存 fake（同
 * `tests/feedback/draft-lifecycle.test.ts` 的写法），不碰真实数据库。
 */
import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/application/design-workbench/create-project";
import { listMyProjects } from "../../src/application/design-workbench/list-my-projects";
import { updateProject } from "../../src/application/design-workbench/update-project";
import { appendProjectChat } from "../../src/application/design-workbench/append-project-chat";
import { deleteProject } from "../../src/application/design-workbench/delete-project";
import { pushToInbox } from "../../src/application/design-workbench/push-to-inbox";
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  type DesignProjectDeps,
} from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";
import { designPrototype, designWorkbench as C } from "@repo/contracts";
import type { DesignChatContext, DesignChatModel, DesignChatReplyResult } from "../../src/application/design-workbench/design-chat-model";

/** B5.2：`DesignChatModel` 的内存 fake——默认退回固定回执（fallback），记录看到的上下文。 */
class FakeDesignChat implements DesignChatModel {
  readonly calls: DesignChatContext[] = [];
  answer: DesignChatReplyResult = { text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {} };
  async reply(ctx: DesignChatContext): Promise<DesignChatReplyResult> {
    this.calls.push({ ...ctx, chat: [...ctx.chat] });
    return this.answer;
  }
}

function deps(projects: FakeDesignProjectRepo = new FakeDesignProjectRepo()): DesignProjectDeps {
  return {
    projects,
    orgId: toOrgId("org-1"),
    submitters: {
      emailForUserId: async () => null,
      displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, `名字-${id}`])),
    },
  };
}

/**
 * B6.3：`pushToInbox` 发「已生成设计方案」邮件用的三个可选依赖一起注入——`mail` 记下每封信，
 * `logger` 记下每条日志，`emails` 是 userId → 邮箱（不在表里 ⇒ `null`，即"账号已不在"）。
 */
function notifyingDeps(
  projects: FakeDesignProjectRepo,
  emails: Record<string, string>,
  opts: { readonly sendFails?: boolean } = {},
) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const logs: { msg: string; fields: Record<string, unknown> }[] = [];
  const d: DesignProjectDeps = {
    ...deps(projects),
    submitters: {
      emailForUserId: async (userId) => emails[userId] ?? null,
      displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, `名字-${id}`])),
    },
    mail: {
      send: async (m) => {
        if (opts.sendFails === true) throw new Error("smtp down");
        sent.push(m);
        return {};
      },
    },
    logger: {
      info: (msg, fields) => void logs.push({ msg, fields }),
      error: (msg, fields) => void logs.push({ msg, fields }),
    },
  };
  return { deps: d, sent, logs };
}

describe("createProject", () => {
  it("服务端填 criteria/frames 快照，chat 恒为 []", async () => {
    const repo = new FakeDesignProjectRepo();
    const out = await createProject(
      { ...deps(repo), newProjectId: () => "dp-1" },
      { ownerId: "u-1", name: "登录改版", template: "wireframe" },
    );
    expect(out.project.criteria).toEqual(C.DESIGN_PROJECT_INITIAL_CRITERIA);
    expect(out.project.frames).toEqual(C.DESIGN_PROJECT_INITIAL_FRAMES);
    expect(out.project.chat).toEqual([]);
    expect(out.project.pushed).toBe(false);
    expect(out.project.ownerName).toBe("名字-u-1");
  });

  it("name 为空白 ⇒ DesignProjectNameRequiredError", async () => {
    await expect(
      createProject({ ...deps(), newProjectId: () => "dp-1" }, { ownerId: "u-1", name: "   ", template: "ui" }),
    ).rejects.toBeInstanceOf(DesignProjectNameRequiredError);
  });

  it("linkedFeedbackId 传入即写入投影（B4.4「深化」的落点，本轮只校验透传）", async () => {
    const repo = new FakeDesignProjectRepo();
    const out = await createProject(
      { ...deps(repo), newProjectId: () => "dp-1" },
      { ownerId: "u-1", name: "深化项目", template: "wireframe", linkedFeedbackId: "fb-9" },
    );
    expect(out.project.linkedFeedbackId).toBe("fb-9");
  });
});

describe("listMyProjects", () => {
  it("按 ownerId 过滤（全组织可读的仓储 + 应用层「我的」过滤）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-mine", ownerId: "u-1", name: "我的项目" }));
    repo.seed(designProjectRow({ id: "dp-other", ownerId: "u-2", name: "别人的项目" }));

    const mine = await listMyProjects(deps(repo), { ownerId: "u-1" });
    expect(mine.map((p) => p.id)).toEqual(["dp-mine"]);
  });

  it("`q` 按名称过滤（大小写不敏感）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", name: "Login Redesign" }));
    repo.seed(designProjectRow({ id: "dp-2", ownerId: "u-1", name: "结算流程" }));

    const out = await listMyProjects(deps(repo), { ownerId: "u-1", q: "login" });
    expect(out.map((p) => p.id)).toEqual(["dp-1"]);
  });
});

describe("updateProject", () => {
  it("owner 可改 name/template/problem，不改 criteria/frames/chat", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", criteria: ["c1"], frames: ["f1"] }));

    const out = await updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", name: "改名了" });
    expect(out.project.name).toBe("改名了");
    expect(out.project.criteria).toEqual(["c1"]);
    expect(out.project.frames).toEqual(["f1"]);
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-2", name: "改名了" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(
      updateProject(deps(), { projectId: "dp-missing", ownerId: "u-1", name: "x" }),
    ).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });

  it("name 传空白 ⇒ DesignProjectNameRequiredError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", name: "  " }),
    ).rejects.toBeInstanceOf(DesignProjectNameRequiredError);
  });
});

describe("appendProjectChat", () => {
  it("模型退路：一次调用追加用户消息 + 固定回执两条，AI 记录标 source=fallback，不写回", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const ai = new FakeDesignChat();

    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "改一下颜色" });
    expect(out.project.chat).toHaveLength(2);
    expect(out.project.chat[0]).toMatchObject({ role: "user", text: "改一下颜色" });
    expect(out.project.chat[0]).not.toHaveProperty("source");
    expect(out.project.chat[1]).toMatchObject({ role: "ai", text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback" });
    expect(out.reply).toEqual({ source: "fallback", applied: [] });
  });

  it("B5.2 模型在：回复来自模型；合法 writeback 直接写回 problem/criteria/frames，applied 如实；返回的是写回后的项目", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", name: "导出改版", problem: "旧背景" }));
    await appendProjectChat({ ...deps(repo), ai: new FakeDesignChat() }, { projectId: "dp-1", ownerId: "u-1", text: "第一句" });
    const ai = new FakeDesignChat();
    ai.answer = { text: "好，验收标准加了导出成功率一条。", source: "model", writeback: { criteria: ["导出成功率 ≥ 99%"], problem: "新背景" } };

    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "把导出成功率写进验收标准" });
    expect(out.reply).toEqual({ source: "model", applied: ["problem", "criteria"] });
    expect(out.project.problem).toBe("新背景");
    expect(out.project.criteria).toEqual(["导出成功率 ≥ 99%"]);
    expect(out.project.frames).toEqual(designProjectRow({ id: "x", ownerId: "u-1" }).frames); // 没写回的不动
    expect(out.project.chat.at(-1)).toMatchObject({ role: "ai", text: "好，验收标准加了导出成功率一条。", source: "model" });
    // 模型看到的是本项目五个字段 + 本项目完整历史（含这次用户消息在末尾）
    const ctx = ai.calls[0];
    expect(ctx).toMatchObject({ name: "导出改版", problem: "旧背景" });
    expect(ctx?.chat.map((c) => c.text)).toEqual(["第一句", C.DESIGN_WORKBENCH_CHAT_REPLY, "把导出成功率写进验收标准"]);
  });

  it("B5.3 prototype 写回：{frame,root}[] 拆成 frames + prototype 一次写入，applied 列 frames 与 prototype；只写回 frames ⇒ 旧树清空", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    const tree = { type: "stack" as const, children: [{ type: "text" as const, props: { content: "hi" } }] };
    const ai = new FakeDesignChat();
    ai.answer = { text: "画好了。", source: "model", writeback: { frames: ["被忽略"], prototype: [{ frame: "聊天", root: tree }, { frame: "设置", root: { type: "divider" } }] } };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "画个聊天 UI" });
    expect(out.reply).toEqual({ source: "model", applied: ["frames", "prototype"] });
    expect(out.project.frames).toEqual(["聊天", "设置"]);
    expect(out.project.prototype).toEqual(designPrototype.ensurePrototypeIds([tree, { type: "divider" }])); // 迭代 1：落库补 id
    expect(ai.calls[0]?.prototype).toEqual([]);

    const relabel = new FakeDesignChat();
    relabel.answer = { text: "改名了。", source: "model", writeback: { frames: ["首页", "设置"] } };
    const out2 = await appendProjectChat({ ...deps(repo), ai: relabel }, { projectId: "dp-1", ownerId: "u-1", text: "第一页叫首页" });
    expect(out2.reply.applied).toEqual(["frames"]);
    expect(out2.project.frames).toEqual(["首页", "设置"]);
    expect(out2.project.prototype).toEqual([]);
    expect(relabel.calls[0]?.prototype).toEqual(designPrototype.ensurePrototypeIds([tree, { type: "divider" }]));
  });

  it("迭代 1 patch 写回：按 id 局部改并落库、applied 记 prototype；整页写回补 id；没原型时 patch 拒、非法 patch 拒但其余字段照写", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    // 没原型 ⇒ patch 无处可打
    const early = new FakeDesignChat();
    early.answer = { text: "改了。", source: "model", writeback: { patch: [{ op: "remove", id: "n1" }], criteria: ["c"] } };
    const out0 = await appendProjectChat({ ...deps(repo), ai: early }, { projectId: "dp-1", ownerId: "u-1", text: "删掉" });
    expect(out0.reply.applied).toEqual(["criteria"]);
    // 整页写回：模型没写 id ⇒ 落库时补齐
    const whole = new FakeDesignChat();
    whole.answer = { text: "画好了。", source: "model", writeback: { prototype: [{ frame: "聊天", root: { type: "stack", children: [{ type: "text", props: { content: "hi" } }, { type: "button", props: { label: "发送" } }] } }] } };
    const out1 = await appendProjectChat({ ...deps(repo), ai: whole }, { projectId: "dp-1", ownerId: "u-1", text: "画个聊天" });
    const root = out1.project.prototype[0];
    expect(root).toMatchObject({ id: "n1", type: "stack" });
    if (root?.type !== "stack") throw new Error("root");
    expect(root.children.map((c) => c.id)).toEqual(["n2", "n3"]);
    // patch：按 id 改
    const p = new FakeDesignChat();
    p.answer = { text: "按钮改成停止。", source: "model", writeback: { patch: [{ op: "setProps", id: "n3", props: { label: "停止", variant: "danger" } }] } };
    const out2 = await appendProjectChat({ ...deps(repo), ai: p }, { projectId: "dp-1", ownerId: "u-1", text: "按钮改成停止" });
    expect(out2.reply.applied).toEqual(["prototype"]);
    const r2 = out2.project.prototype[0];
    if (r2?.type !== "stack") throw new Error("r2");
    expect(r2.children[1]).toMatchObject({ id: "n3", props: { label: "停止", variant: "danger" } });
    expect(out2.project.frames).toEqual(["聊天"]);
    expect(p.calls[0]?.prototype[0]).toMatchObject({ id: "n1" }); // 模型看到的是带 id 的树
    // 非法 patch（未知 id）⇒ prototype 不动，problem 照写
    const bad = new FakeDesignChat();
    bad.answer = { text: "x", source: "model", writeback: { patch: [{ op: "remove", id: "zzz" }], problem: "新背景" } };
    const out3 = await appendProjectChat({ ...deps(repo), ai: bad }, { projectId: "dp-1", ownerId: "u-1", text: "删" });
    expect(out3.reply.applied).toEqual(["problem"]);
    expect(out3.project.prototype).toEqual(out2.project.prototype);
  });

  it("每项目独立 thread：模型只看到本项目的历史，不混入别的项目", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    repo.seed(designProjectRow({ id: "dp-2", ownerId: "u-1" }));
    await appendProjectChat({ ...deps(repo), ai: new FakeDesignChat() }, { projectId: "dp-2", ownerId: "u-1", text: "dp-2 的话" });
    const ai = new FakeDesignChat();
    await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "dp-1 的话" });
    expect(ai.calls[0]?.chat.map((c) => c.text)).toEqual(["dp-1 的话"]);
  });

  it("非 owner ⇒ DesignProjectNotOwnerError，且不调模型", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const ai = new FakeDesignChat();
    await expect(
      appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-2", text: "x" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    expect(ai.calls).toHaveLength(0);
  });
});

describe("deleteProject", () => {
  it("owner 可删（未推送）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const out = await deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(out.projectId).toBe("dp-1");
    expect(await repo.get("dp-1")).toBeNull();
  });

  it("owner 可删（已推送——需求未对已推送项目设限）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", pushed: true }));
    const out = await deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(out.projectId).toBe("dp-1");
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-2" })).rejects.toBeInstanceOf(
      DesignProjectNotOwnerError,
    );
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(deleteProject(deps(), { projectId: "dp-missing", ownerId: "u-1" })).rejects.toBeInstanceOf(
      DesignProjectNotFoundError,
    );
  });
});

describe("pushToInbox", () => {
  it("标记 pushed/pushedAt，回写来源反馈的 resolved_by_design_id", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: "fb-1" }));

    const out = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "给工程看看" });
    expect(out.project.pushed).toBe(true);
    expect(out.project.pushedAt).not.toBeNull();
    expect(out.inboxCode).toBe("D-1");
    expect(repo.resolvedFeedbackIds).toEqual(["fb-1"]);
  });

  it("linkedFeedbackId 为空时不触发反馈回写", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: null }));
    await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(repo.resolvedFeedbackIds).toEqual([]);
  });

  it("幂等：重复推送更新同一条,inboxCode 不变,不产生第二条", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));

    const first = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "第一次" });
    const second = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "第二次，改了说明" });

    expect(first.inboxCode).toBe(second.inboxCode);
    expect(repo.rows.size).toBe(1);
    expect((await repo.get("dp-1"))?.pushNote).toBe("第二次，改了说明");
  });

  it("编号按创建顺序：先创建的先推送不影响谁是 D-1（按 created_at,不是按推送顺序）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-old", ownerId: "u-1", createdAt: "2026-09-01T00:00:00.000Z" }));
    repo.seed(designProjectRow({ id: "dp-new", ownerId: "u-1", createdAt: "2026-09-02T00:00:00.000Z" }));

    // 后创建的先推送。
    const newFirst = await pushToInbox(deps(repo), { projectId: "dp-new", ownerId: "u-1" });
    expect(newFirst.inboxCode).toBe("D-1"); // 此刻只有它一条 pushed=true。

    const oldSecond = await pushToInbox(deps(repo), { projectId: "dp-old", ownerId: "u-1" });
    // 现在两条都 pushed=true，按 created_at 排序：dp-old 在前 ⇒ D-1，dp-new 变成 D-2。
    expect(oldSecond.inboxCode).toBe("D-1");
  });

  // ---- B6.3：「反馈已生成设计方案」通知 ----

  it("B6.3：有 linkedFeedbackId 且首次回写 ⇒ 给来源反馈提交人发一封带 D-n 编号的邮件", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", name: "登录页改版", linkedFeedbackId: "fb-1" }));
    repo.seedFeedback("fb-1", { submittedBy: "u-reporter", title: "点了没反应" });
    const n = notifyingDeps(repo, { "u-reporter": "reporter@example.com" });

    const out = await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm" });

    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]?.to).toBe("reporter@example.com");
    expect(n.sent[0]?.subject).toContain(out.inboxCode);
    expect(n.sent[0]?.subject).toContain("点了没反应");
    expect(n.sent[0]?.text).toContain("登录页改版");
    expect(out.project.pushed).toBe(true);
  });

  it("B6.3：linkedFeedbackId 为空 ⇒ 不发邮件", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", linkedFeedbackId: null }));
    const n = notifyingDeps(repo, { "u-reporter": "reporter@example.com" });
    await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm" });
    expect(n.sent).toEqual([]);
  });

  it("B6.3：重复推送（upsert）⇒ 只在外键首次指向本项目时通知一次，不发第二封", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", linkedFeedbackId: "fb-1" }));
    repo.seedFeedback("fb-1", { submittedBy: "u-reporter", title: "点了没反应" });
    const n = notifyingDeps(repo, { "u-reporter": "reporter@example.com" });

    await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm", note: "第一次" });
    await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm", note: "第二次，改了说明" });

    expect(n.sent).toHaveLength(1);
    expect((await repo.get("dp-1"))?.pushNote).toBe("第二次，改了说明");
  });

  it("B6.3：提交人账号已不在（无邮箱）⇒ 不发、记 info 日志、推送照常成功", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", linkedFeedbackId: "fb-1" }));
    repo.seedFeedback("fb-1", { submittedBy: "u-gone", title: "点了没反应" });
    const n = notifyingDeps(repo, {});
    const out = await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm" });
    expect(out.project.pushed).toBe(true);
    expect(n.sent).toEqual([]);
    expect(n.logs.some((l) => l.msg.includes("no resolvable email") && l.fields.feedbackId === "fb-1")).toBe(true);
  });

  it("B6.3：邮件发送失败 ⇒ 推送不受影响（不抛），记 error 日志", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", linkedFeedbackId: "fb-1" }));
    repo.seedFeedback("fb-1", { submittedBy: "u-reporter", title: "点了没反应" });
    const n = notifyingDeps(repo, { "u-reporter": "reporter@example.com" }, { sendFails: true });
    const out = await pushToInbox(n.deps, { projectId: "dp-1", ownerId: "u-pm" });
    expect(out.project.pushed).toBe(true);
    expect(repo.resolvedFeedbackIds).toEqual(["fb-1"]);
    expect(n.logs.some((l) => l.msg.includes("notification failed") && l.fields.projectId === "dp-1")).toBe(true);
  });

  it("B6.3：未注入 mail/logger（既有调用方形状）⇒ 不发、不抛", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-pm", linkedFeedbackId: "fb-1" }));
    const out = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-pm" });
    expect(out.project.pushed).toBe(true);
    expect(repo.resolvedFeedbackIds).toEqual(["fb-1"]);
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-2" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(
      pushToInbox(deps(), { projectId: "dp-missing", ownerId: "u-1" }),
    ).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });
});

/* ── UC-17.8 B6.4 可观测性：推送事务一条结构化日志（fake logger 断言字段存在） ── */
describe("pushToInbox 可观测性（B6.4）", () => {
  function fields(logger: { info: ReturnType<typeof vi.fn> }, nth = 0): Record<string, unknown> {
    const [msg, f] = logger.info.mock.calls[nth] as [string, Record<string, unknown>];
    expect(msg).toBe("design-workbench: pushToInbox");
    return f;
  }

  it("首次推送：projectId / ownerId / resolvedFeedback / repeatPush=false / inboxCode / 耗时 / traceId", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: "fb-1" }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await pushToInbox({ ...deps(repo), logger, traceId: "trace-push" }, { projectId: "dp-1", ownerId: "u-1", note: "给工程看看" });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const f = fields(logger);
    expect(f).toMatchObject({
      traceId: "trace-push",
      orgId: "org-1",
      projectId: "dp-1",
      ownerId: "u-1",
      repeatPush: false,
      linkedFeedback: true,
      resolvedFeedback: true,
      notePresent: true,
      inboxCode: "D-1",
    });
    expect(typeof f.transactionMs).toBe("number");
    expect(typeof f.durationMs).toBe("number");
    // 不记 note 正文 / 项目名
    expect(JSON.stringify(f)).not.toContain("给工程看看");
  });

  it("重复推送（upsert 命中）⇒ repeatPush=true；无来源反馈 ⇒ linkedFeedback=false、resolvedFeedback=false", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: null }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const d = { ...deps(repo), logger };

    await pushToInbox(d, { projectId: "dp-1", ownerId: "u-1" });
    await pushToInbox(d, { projectId: "dp-1", ownerId: "u-1", note: "第二次" });

    expect(fields(logger, 0)).toMatchObject({ repeatPush: false, linkedFeedback: false, resolvedFeedback: false, notePresent: false });
    expect(fields(logger, 1)).toMatchObject({ repeatPush: true, notePresent: true, inboxCode: "D-1" });
  });

  it("非 owner / 不存在 ⇒ 抛错且不记 info（失败路径由 AllExceptionsFilter 按 traceId 记）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(pushToInbox({ ...deps(repo), logger }, { projectId: "dp-1", ownerId: "u-2" })).rejects.toBeInstanceOf(
      DesignProjectNotOwnerError,
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
