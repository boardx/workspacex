/**
 * UC-17.8 B4.3 —— 六个设计项目用例的正反例，全部用内存 fake（同
 * `tests/feedback/draft-lifecycle.test.ts` 的写法），不碰真实数据库。
 */
import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/application/design-workbench/create-project";
import { listMyProjects } from "../../src/application/design-workbench/list-my-projects";
import { updateProject } from "../../src/application/design-workbench/update-project";
import { appendProjectChat } from "../../src/application/design-workbench/append-project-chat";
import {
  PrototypeVersionNotFoundError,
  getPrototypeVersion,
  listPrototypeVersions,
  restorePrototypeVersion,
} from "../../src/application/design-workbench/prototype-versions";
import { deleteProject } from "../../src/application/design-workbench/delete-project";
import {
  DesignThreadSummaryUnavailableError,
  importThread,
} from "../../src/application/design-workbench/import-thread";
import { ThreadNotVisibleError } from "../../src/application/chat/get-thread";
import { PrototypePatchRejectedError, patchPrototype } from "../../src/application/design-workbench/patch-prototype";
import { pushToInbox } from "../../src/application/design-workbench/push-to-inbox";
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  type DesignProjectDeps,
} from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";
import {
  FakeChatThreadSource,
  FakeIdentityDirectory,
  fakeDecisionIds,
  personalThread,
} from "../support/fake-chat-thread-source";
import { designPrototype, designWorkbench as C } from "@repo/contracts";
import type { DesignChatContext, DesignChatModel, DesignChatReplyResult } from "../../src/application/design-workbench/design-chat-model";

/** B5.2：`DesignChatModel` 的内存 fake——默认退回固定回执（fallback），记录看到的上下文。 */
class FakeDesignChat implements DesignChatModel {
  readonly calls: DesignChatContext[] = [];
  answer: DesignChatReplyResult = { text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {} , suggestions: [] };
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

  /**
   * 迭代 13（delta §4）—— V65。排序在**仓储**那一层，`listMyProjects` 只过滤不排序。
   * 断言写在这里是因为它是用户能看见的行为；实现位置由下面那条「不二次排序」钉住。
   */
  it("V65 按 updatedAt 倒序：最近改过的排最前", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-old", ownerId: "u-1", updatedAt: "2026-09-01T00:00:00.000Z" }));
    repo.seed(designProjectRow({ id: "dp-new", ownerId: "u-1", updatedAt: "2026-09-08T00:00:00.000Z" }));
    repo.seed(designProjectRow({ id: "dp-mid", ownerId: "u-1", updatedAt: "2026-09-05T00:00:00.000Z" }));

    const out = await listMyProjects(deps(repo), { ownerId: "u-1" });
    // ⭐ 反证：改成 createdAt 倒序 ⇒ 这条红（三行的 createdAt 都是夹具默认值，同一个时刻）。
    expect(out.map((p) => p.id)).toEqual(["dp-new", "dp-mid", "dp-old"]);
  });

  it("V65 用例层**不**二次排序：仓储给什么顺序就是什么顺序", async () => {
    const repo = new FakeDesignProjectRepo();
    // ⚠ 这两行的 id 与 updatedAt 是**反向**排的（a 最新、b 最旧），所以期望顺序
    //   `[dp-b, dp-a]` 既不是 id 升序、也不是 updatedAt 倒序——用例层无论按哪个字段
    //   补一次 sort，都会把它改掉。第一版这里用的是 id 与时间同向的数据，
    //   于是"加一句 sort"这个变异**没能让它转红**（实测），它是为错误理由通过的。
    repo.seed(designProjectRow({ id: "dp-a", ownerId: "u-1", updatedAt: "2026-09-08T00:00:00.000Z" }));
    repo.seed(designProjectRow({ id: "dp-b", ownerId: "u-1", updatedAt: "2026-09-01T00:00:00.000Z" }));
    // 仓储被换成一个**故意乱序**的实现：如果用例层自己排了序，下面这条就会被"修正"。
    const scrambled = { ...repo, listForOrg: async () => [...(await repo.listForOrg())].reverse() };
    const out = await listMyProjects(deps(scrambled as unknown as FakeDesignProjectRepo), { ownerId: "u-1" });
    // ⭐ 反证：在 `listMyProjects` 里加一句 sort（按 id 或按 updatedAt 都算）⇒ 这条红。
    //   顺序只该由 SQL 的 ORDER BY 决定，否则将来一分页，页内重排会让整体顺序看起来是随机的。
    expect(out.map((p) => p.id)).toEqual(["dp-b", "dp-a"]);
  });

  describe("V66 标签：过滤取交集，集合从现有项目派生", () => {
    const seeded = () => {
      const repo = new FakeDesignProjectRepo();
      repo.seed(designProjectRow({ id: "dp-both", ownerId: "u-1", tags: ["后台", "移动端"] }));
      repo.seed(designProjectRow({ id: "dp-one", ownerId: "u-1", tags: ["后台"] }));
      repo.seed(designProjectRow({ id: "dp-none", ownerId: "u-1", tags: [] }));
      return repo;
    };

    it("选两个标签 ⇒ 只返回**同时**有这两个的项目（不是并集）", async () => {
      const out = await listMyProjects(deps(seeded()), { ownerId: "u-1", tags: ["后台", "移动端"] });
      // ⭐ 反证：过滤实现成 `some`（并集）⇒ dp-one 会混进来，这条红。
      expect(out.map((p) => p.id)).toEqual(["dp-both"]);
    });

    it("选一个标签 ⇒ 带这个标签的都返回；不选 ⇒ 全返回", async () => {
      const repo = seeded();
      expect((await listMyProjects(deps(repo), { ownerId: "u-1", tags: ["后台"] })).map((p) => p.id).sort())
        .toEqual(["dp-both", "dp-one"]);
      expect(await listMyProjects(deps(repo), { ownerId: "u-1", tags: [] })).toHaveLength(3);
    });

    it("标签与 `q` 一起用是**并且**，不是二选一", async () => {
      const repo = new FakeDesignProjectRepo();
      repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", name: "登录改版", tags: ["后台"] }));
      repo.seed(designProjectRow({ id: "dp-2", ownerId: "u-1", name: "结算流程", tags: ["后台"] }));
      const out = await listMyProjects(deps(repo), { ownerId: "u-1", q: "登录", tags: ["后台"] });
      expect(out.map((p) => p.id)).toEqual(["dp-1"]);
    });

    it("新建带标签：去空白、丢空串、去重", async () => {
      const repo = new FakeDesignProjectRepo();
      const out = await createProject(
        { ...deps(repo), newProjectId: () => "dp-1" },
        { ownerId: "u-1", name: "带标签", template: "ui", tags: ["  后台 ", "后台", "", "   ", "移动端"] },
      );
      expect(out.project.tags).toEqual(["后台", "移动端"]);
    });

    it("改标签是**整份替换**，不是往上加", async () => {
      const repo = new FakeDesignProjectRepo();
      repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", tags: ["旧一", "旧二"] }));
      const out = await updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", tags: ["新的"] });
      // ⭐ 反证：实现成并集/追加 ⇒ 这条红（那样就永远删不掉一个标签）。
      expect(out.project.tags).toEqual(["新的"]);
      const cleared = await updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", tags: [] });
      expect(cleared.project.tags).toEqual([]);
    });

    it("不给 tags ⇒ 原样保留（PATCH 语义，不是清空）", async () => {
      const repo = new FakeDesignProjectRepo();
      repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", tags: ["保留我"] }));
      const out = await updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", name: "改个名" });
      expect(out.project.tags).toEqual(["保留我"]);
    });

    it("上限与长度由契约的同一份 schema 判，不是应用层第二套阈值", () => {
      const ok = Array.from({ length: C.DESIGN_PROJECT_MAX_TAGS }, (_, i) => `t${i}`);
      expect(C.DesignProjectTags.safeParse(ok).success).toBe(true);
      expect(C.DesignProjectTags.safeParse([...ok, "多一个"]).success).toBe(false);
      expect(C.DesignProjectTags.safeParse(["x".repeat(C.DESIGN_PROJECT_TAG_MAX_CHARS + 1)]).success).toBe(false);
      // ⭐ 反证：在用例层另写一个 `if (tags.length > 8)` ⇒ 阈值就有两处，改一处不改另一处
      //   的表现是"契约说能存 10 个、界面说只能 8 个"。这条断言指的是契约那一份。
    });
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
    expect(out.reply).toEqual({ source: "fallback", applied: [], suggestions: [] });
  });

  it("B5.2 模型在：回复来自模型；合法 writeback 直接写回 problem/criteria/frames，applied 如实；返回的是写回后的项目", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", name: "导出改版", problem: "旧背景" }));
    await appendProjectChat({ ...deps(repo), ai: new FakeDesignChat() }, { projectId: "dp-1", ownerId: "u-1", text: "第一句" });
    const ai = new FakeDesignChat();
    ai.answer = { text: "好，验收标准加了导出成功率一条。", source: "model", writeback: { criteria: ["导出成功率 ≥ 99%"], problem: "新背景" } , suggestions: [] };

    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "把导出成功率写进验收标准" });
    expect(out.reply).toEqual({ source: "model", applied: ["problem", "criteria"], suggestions: [] });
    expect(out.project.problem).toBe("新背景");
    expect(out.project.criteria).toEqual(["导出成功率 ≥ 99%"]);
    expect(out.project.frames).toEqual(designProjectRow({ id: "x", ownerId: "u-1" }).frames); // 没写回的不动
    expect(out.project.chat.at(-1)).toMatchObject({ role: "ai", text: "好，验收标准加了导出成功率一条。", source: "model" });
    // 模型看到的是本项目五个字段 + 本项目完整历史（含这次用户消息在末尾）
    const ctx = ai.calls[0];
    expect(ctx).toMatchObject({ name: "导出改版", problem: "旧背景" });
    expect(ctx?.chat.map((c) => c.text)).toEqual(["第一句", C.DESIGN_WORKBENCH_CHAT_REPLY, "把导出成功率写进验收标准"]);
  });

  it("B5.3 prototype 写回：{frame,root}[] 拆成 frames + prototype 一次写入，applied 列 frames 与 prototype；只写回 frames 且等长 ⇒ 纯改标签，树保留", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    const tree = { type: "stack" as const, children: [{ type: "text" as const, props: { content: "hi" } }] };
    const ai = new FakeDesignChat();
    ai.answer = { text: "画好了。", source: "model", writeback: { frames: ["被忽略"], prototype: [{ frame: "聊天", root: tree }, { frame: "设置", root: { type: "divider" } }] } , suggestions: [] };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "画个聊天 UI" });
    expect(out.reply).toEqual({ source: "model", applied: ["frames", "prototype"], suggestions: [] });
    expect(out.project.frames).toEqual(["聊天", "设置"]);
    expect(out.project.prototype).toEqual(designPrototype.ensurePrototypeIds([tree, { type: "divider" }])); // 迭代 1：落库补 id
    expect(ai.calls[0]?.prototype).toEqual([]);

    const relabel = new FakeDesignChat();
    relabel.answer = { text: "改名了。", source: "model", writeback: { frames: ["首页", "设置"] } , suggestions: [] };
    const out2 = await appendProjectChat({ ...deps(repo), ai: relabel }, { projectId: "dp-1", ownerId: "u-1", text: "第一页叫首页" });
    expect(out2.reply.applied).toEqual(["frames"]);
    expect(out2.project.frames).toEqual(["首页", "设置"]);
    // 2026-09-07：等长的纯改标签**保留**旧树。此前这里断言的是 `[]`（清空）——那正是用户
    // 实测「怎么全部空了？」的来源：改个标签把画好的原型一起带走了。
    expect(out2.project.prototype).toEqual(designPrototype.ensurePrototypeIds([tree, { type: "divider" }]));
    expect(relabel.calls[0]?.prototype).toEqual(designPrototype.ensurePrototypeIds([tree, { type: "divider" }]));
  });

  /**
   * 2026-09-07 用户实测的数据丢失（本条是它的反证）：用户说「增加设置页」，模型只回了
   * `writeback.frames`（页数 +1）、没给 `prototype`。若照写，库里 frames=3 / prototype=2，
   * 读取侧 `toPrototype` 长度对不上就整份返回 `[]` —— 整个画布下一次读取时全空。
   * 现在这次 `frames` 被字段级拒绝（同 I-10：宁可不写，也不写坏），已画好的树一页不少。
   */
  it("增删页只给 frames 不给 prototype ⇒ 拒绝这次 frames，已有原型不被清空", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    const draw = new FakeDesignChat();
    draw.answer = { text: "画好了。", source: "model", writeback: { prototype: [
      { frame: "对话", root: { type: "stack", children: [{ type: "text", props: { content: "hi" } }] } },
      { frame: "欢迎页", root: { type: "divider" } },
    ] }, suggestions: [] };
    await appendProjectChat({ ...deps(repo), ai: draw }, { projectId: "dp-1", ownerId: "u-1", text: "画个 chat" });

    const addPage = new FakeDesignChat();
    addPage.answer = { text: "已新增设置页。", source: "model", writeback: { frames: ["对话", "欢迎页", "设置"] }, suggestions: [] };
    const out = await appendProjectChat({ ...deps(repo), ai: addPage }, { projectId: "dp-1", ownerId: "u-1", text: "增加设置页" });

    expect(out.reply.applied).toEqual([]);            // 这次 frames 没被写
    expect(out.project.frames).toEqual(["对话", "欢迎页"]); // 页标签也没动
    expect(out.project.prototype).toHaveLength(2);     // 关键：画好的两页还在
  });

  it("迭代 1 patch 写回：按 id 局部改并落库、applied 记 prototype；整页写回补 id；没原型时 patch 拒、非法 patch 拒但其余字段照写", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    // 没原型 ⇒ patch 无处可打
    const early = new FakeDesignChat();
    early.answer = { text: "改了。", source: "model", writeback: { patch: [{ op: "remove", id: "n1" }], criteria: ["c"] } , suggestions: [] };
    const out0 = await appendProjectChat({ ...deps(repo), ai: early }, { projectId: "dp-1", ownerId: "u-1", text: "删掉" });
    expect(out0.reply.applied).toEqual(["criteria"]);
    // 整页写回：模型没写 id ⇒ 落库时补齐
    const whole = new FakeDesignChat();
    whole.answer = { text: "画好了。", source: "model", writeback: { prototype: [{ frame: "聊天", root: { type: "stack", children: [{ type: "text", props: { content: "hi" } }, { type: "button", props: { label: "发送" } }] } }] } , suggestions: [] };
    const out1 = await appendProjectChat({ ...deps(repo), ai: whole }, { projectId: "dp-1", ownerId: "u-1", text: "画个聊天" });
    const root = out1.project.prototype[0];
    expect(root).toMatchObject({ id: "n1", type: "stack" });
    if (root?.type !== "stack") throw new Error("root");
    expect(root.children.map((c) => c.id)).toEqual(["n2", "n3"]);
    // patch：按 id 改
    const p = new FakeDesignChat();
    p.answer = { text: "按钮改成停止。", source: "model", writeback: { patch: [{ op: "setProps", id: "n3", props: { label: "停止", variant: "danger" } }] } , suggestions: [] };
    const out2 = await appendProjectChat({ ...deps(repo), ai: p }, { projectId: "dp-1", ownerId: "u-1", text: "按钮改成停止" });
    expect(out2.reply.applied).toEqual(["prototype"]);
    const r2 = out2.project.prototype[0];
    if (r2?.type !== "stack") throw new Error("r2");
    expect(r2.children[1]).toMatchObject({ id: "n3", props: { label: "停止", variant: "danger" } });
    expect(out2.project.frames).toEqual(["聊天"]);
    expect(p.calls[0]?.prototype[0]).toMatchObject({ id: "n1" }); // 模型看到的是带 id 的树
    // 非法 patch（未知 id）⇒ prototype 不动，problem 照写
    const bad = new FakeDesignChat();
    bad.answer = { text: "x", source: "model", writeback: { patch: [{ op: "remove", id: "zzz" }], problem: "新背景" } , suggestions: [] };
    const out3 = await appendProjectChat({ ...deps(repo), ai: bad }, { projectId: "dp-1", ownerId: "u-1", text: "删" });
    expect(out3.reply.applied).toEqual(["problem"]);
    expect(out3.project.prototype).toEqual(out2.project.prototype);
  });

  it("迭代 2 focusNodeId：找得到 ⇒ 模型上下文带 focus（页、路径、节点）；找不到 ⇒ 不带", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["聊天"], prototype: [
      { id: "n1", type: "stack", children: [{ id: "n2", type: "button", props: { label: "发送" } }] },
    ] }));
    const ai = new FakeDesignChat();
    await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "改成红色", focusNodeId: "n2" });
    expect(ai.calls[0]?.focus).toEqual({ id: "n2", frame: "聊天", path: ["纵向布局", "按钮「发送」"], node: { id: "n2", type: "button", props: { label: "发送" } } });
    const ai2 = new FakeDesignChat();
    await appendProjectChat({ ...deps(repo), ai: ai2 }, { projectId: "dp-1", ownerId: "u-1", text: "x", focusNodeId: "gone" });
    expect(ai2.calls[0]?.focus).toBeUndefined();
  });

  it("迭代 3 版本历史：prototype 写回（整页/patch）各记一版、只改标签不记；列表倒序不带树；单条带树；恢复写回旧版并再追加 restore 一版；非 owner 不能恢复；未知版本 404", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["草稿页 1"] }));
    const whole = new FakeDesignChat();
    whole.answer = { text: "画好了，两页。", source: "model", writeback: { prototype: [{ frame: "聊天", root: { type: "stack", children: [{ type: "text", props: { content: "v1" } }] }, notes: " 首屏可发消息 " }] } , suggestions: [] };
    await appendProjectChat({ ...deps(repo), ai: whole }, { projectId: "dp-1", ownerId: "u-1", text: "画" });
    const p = new FakeDesignChat();
    p.answer = { text: "改了文案。", source: "model", writeback: { patch: [{ op: "setProps", id: "n2", props: { content: "v2" } }] } , suggestions: [] };
    await appendProjectChat({ ...deps(repo), ai: p }, { projectId: "dp-1", ownerId: "u-1", text: "改" });
    const relabel = new FakeDesignChat();
    relabel.answer = { text: "改名。", source: "model", writeback: { frames: ["首页"] } , suggestions: [] };
    await appendProjectChat({ ...deps(repo), ai: relabel }, { projectId: "dp-1", ownerId: "u-1", text: "改名" });

    const { items } = await listPrototypeVersions(deps(repo), { projectId: "dp-1" });
    expect(items.map((v) => [v.seq, v.source, v.summary])).toEqual([[2, "model", "改了文案。"], [1, "model", "画好了，两页。"]]);
    expect(items[0]).not.toHaveProperty("prototype");
    const v1 = await getPrototypeVersion(deps(repo), { projectId: "dp-1", versionId: items[1]!.id });
    expect(v1.version.prototype[0]).toMatchObject({ type: "stack", children: [{ props: { content: "v1" } }] });
    expect(v1.version.frames).toEqual(["聊天"]);
    expect(v1.version.notes).toEqual(["首屏可发消息"]); // 迭代 8：notes 随整页写回落库并进版本（trim）

    // 当前项目：标签被改成「首页」，等长纯改标签**不动树**（2026-09-07 起；此前这里是清空，
    // 那正是用户实测「怎么全部空了？」的来源）。所以「只改标签不记一版」仍成立——
    // 不是因为树没了，而是因为树压根没变。
    expect((await repo.get("dp-1"))?.frames).toEqual(["首页"]);
    expect((await repo.get("dp-1"))?.prototype).toHaveLength(1);
    const restored = await restorePrototypeVersion(deps(repo), { projectId: "dp-1", ownerId: "u-1", versionId: items[1]!.id });
    expect(restored.project.frames).toEqual(["聊天"]);
    expect(restored.project.prototype[0]).toMatchObject({ children: [{ props: { content: "v1" } }] });
    expect(restored.version).toMatchObject({ seq: 3, source: "restore", summary: "恢复自 v1" });
    expect(restored.project.frameNotes).toEqual(v1.version.notes); // 迭代 8：说明随版本恢复
    expect((await listPrototypeVersions(deps(repo), { projectId: "dp-1" })).items).toHaveLength(3);

    await expect(restorePrototypeVersion(deps(repo), { projectId: "dp-1", ownerId: "u-2", versionId: items[1]!.id })).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    await expect(getPrototypeVersion(deps(repo), { projectId: "dp-1", versionId: "nope" })).rejects.toBeInstanceOf(PrototypeVersionNotFoundError);
    await expect(listPrototypeVersions(deps(repo), { projectId: "nope" })).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });

  it("迭代 5 patchPrototype：owner 直接改 ⇒ 同一条 applyPrototypePatch、记 user 版本；未知 id ⇒ PROTOTYPE_PATCH_REJECTED 带 detail；没原型 ⇒ 拒；非 owner ⇒ 403", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["页"], prototype: [{ id: "n1", type: "stack", children: [{ id: "n2", type: "button", props: { label: "发送" } }] }] }));
    const out = await patchPrototype(deps(repo), { projectId: "dp-1", ownerId: "u-1", ops: [{ op: "setProps", id: "n2", props: { label: "停止" } }], summary: "改了按钮" });
    const root = out.project.prototype[0];
    if (root?.type !== "stack") throw new Error("root");
    expect(root.children[0]).toMatchObject({ id: "n2", props: { label: "停止" } });
    expect(repo.versions.map((v) => [v.source, v.summary])).toEqual([["user", "改了按钮"]]);
    await expect(patchPrototype(deps(repo), { projectId: "dp-1", ownerId: "u-1", ops: [{ op: "remove", id: "zzz" }] })).rejects.toMatchObject({ reason: "UNKNOWN_NODE", nodeId: "zzz" });
    await expect(patchPrototype(deps(repo), { projectId: "dp-1", ownerId: "u-2", ops: [{ op: "remove", id: "n2" }] })).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    repo.seed(designProjectRow({ id: "dp-2", ownerId: "u-1" }));
    await expect(patchPrototype(deps(repo), { projectId: "dp-2", ownerId: "u-1", ops: [{ op: "remove", id: "n2" }] })).rejects.toMatchObject({ reason: "NO_PROTOTYPE" });
    expect(new PrototypePatchRejectedError("LIMITS", "x")).toBeInstanceOf(Error);
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

/* ───────── 迭代 13（delta `design-chat-inputs` §2）：从已有对话导入 —— V56 / V57 ───────── */

/**
 * ## 这几条用例的 fake 边界在哪，为什么在那里
 *
 * `FakeChatThreadSource` / `FakeIdentityDirectory` fake 的只是**数据源**（线程与消息在哪、
 * 谁是组织成员）。判权跑的是真的那一份：`resolveVisibility` → `decidePersonalThreadRead`
 * → 守卫读路径。所以 V56 的反证成立——把 `import-thread.ts` 里的 `resolveVisibility` 拿掉、
 * 直接 `findMessages`，「导入别人的线程」那条当场变红。
 */
const importDeps = (
  projects: FakeDesignProjectRepo,
  chat: FakeChatThreadSource,
  complete: (input: { system: string; user: string }) => Promise<{ text: string }> = async () => ({ text: "摘要：门店会员在线下单，省掉排队。" }),
) => {
  const model = { complete: vi.fn(complete) };
  const log = vi.fn();
  return {
    d: {
      ...deps(projects),
      chat: chat as never,
      repo: new FakeIdentityDirectory(new Set(["u-owner", "u-other"])) as never,
      ids: fakeDecisionIds(),
      model: model as never,
      chatModel: { provider: "p", modelId: "m" },
      log,
    },
    model,
    log,
  };
};

describe("V56 导入线程：只读得到自己有权读的线程", () => {
  it("别人的个人线程 ⇒ 与 getThread 同一个出口（ThreadNotVisibleError），且不泄露标题", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: "u-owner", problem: "我自己写的背景" }));
    const chat = new FakeChatThreadSource();
    chat.seed(personalThread({ threadId: "th-secret", createdBy: "u-other", title: "别人的私密线程标题" }));

    const { d } = importDeps(projects, chat);
    const err = await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-secret" })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(ThreadNotVisibleError);
    // 拒绝里连标题都不许出现（I-3：拒绝不泄露存在性，更不泄露内容）。
    expect(JSON.stringify({ message: (err as Error).message })).not.toContain("别人的私密线程标题");
    // 拒绝就是拒绝：项目一个字没改，也没留下任何痕迹。
    expect(projects.rows.get("dp-1")!.problem).toBe("我自己写的背景");
    expect(projects.rows.get("dp-1")!.chat).toEqual([]);
  });

  it("不存在的线程与看不见的线程是同一个错误——调用方分不出来", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: "u-owner" }));
    const chat = new FakeChatThreadSource();
    chat.seed(personalThread({ threadId: "th-secret", createdBy: "u-other" }));
    const { d } = importDeps(projects, chat);

    const invisible = await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-secret" }).catch((e: unknown) => e);
    const missing = await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-nope" }).catch((e: unknown) => e);
    expect((invisible as Error).constructor).toBe((missing as Error).constructor);
    expect((invisible as Error).message).toBe((missing as Error).message);
  });

  it("不是项目 owner ⇒ NOT_PROJECT_OWNER，且**根本没去读线程**", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: "u-owner" }));
    const chat = new FakeChatThreadSource();
    chat.seed(personalThread({ threadId: "th-1", createdBy: "u-other" }));
    const { d } = importDeps(projects, chat);

    await expect(importThread(d, { projectId: "dp-1", ownerId: "u-other", threadId: "th-1" }))
      .rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    // owner 门在最前面：不是 owner 的调用不该因为这次请求去读任何线程正文。
    expect(chat.messageReads).toEqual([]);
  });
});

describe("V57 导入是一次性的，且留痕", () => {
  const seeded = () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: "u-owner", problem: "用户已经写好的背景" }));
    const chat = new FakeChatThreadSource();
    chat.seed(personalThread({ threadId: "th-1", createdBy: "u-owner", title: "会员下单那条线" }));
    return { projects, chat };
  };

  it("预览（不给 problem）⇒ 摘要回传，但项目一个字没写", async () => {
    const { projects, chat } = seeded();
    const { d, model } = importDeps(projects, chat);

    const out = await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-1" });

    expect(out.summary).toContain("门店会员");
    expect(out.imported).toEqual({ threadId: "th-1", title: "会员下单那条线", messageCount: 3, at: expect.any(String) });
    expect(model.complete).toHaveBeenCalledTimes(1);
    // ⭐ 反证锚点（V58 的服务端半边）：把「不给 problem 就不写」改成选中即写 ⇒ 这两条红。
    expect(projects.rows.get("dp-1")!.problem).toBe("用户已经写好的背景");
    expect(projects.rows.get("dp-1")!.chat).toEqual([]);
    expect(out.project.problem).toBe("用户已经写好的背景");
  });

  it("确认（给了 problem）⇒ 写入的是**传进来的那段**，不是重新摘要一遍", async () => {
    const { projects, chat } = seeded();
    const { d, model } = importDeps(projects, chat);

    const out = await importThread(d, {
      projectId: "dp-1", ownerId: "u-owner", threadId: "th-1",
      problem: "我在预览里改过的版本：门店会员在线下单，首屏直接下单。",
    });

    expect(projects.rows.get("dp-1")!.problem).toBe("我在预览里改过的版本：门店会员在线下单，首屏直接下单。");
    expect(out.project.problem).toBe("我在预览里改过的版本：门店会员在线下单，首屏直接下单。");
    // 确认阶段不调模型——调了就会把用户刚才的修改重新摘要覆盖掉。
    expect(model.complete).not.toHaveBeenCalled();
    // 但**重新读了线程**：留痕里的标题与条数必须是服务端自己读到的事实，不能信前端。
    expect(chat.messageReads).toEqual(["th-1"]);
  });

  it("确认后 chat 里多一条 source:\"system\" 的留痕，记「从线程《X》导入了 N 条」", async () => {
    const { projects, chat } = seeded();
    const { d } = importDeps(projects, chat);

    await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-1", problem: "写入的背景" });

    const turns = projects.rows.get("dp-1")!.chat;
    expect(turns).toHaveLength(1);
    // ⭐ 反证锚点：删掉留痕那一步 ⇒ 这条红（半年后没人知道背景是从哪来的）。
    expect(turns[0]!.source).toBe("system");
    expect(turns[0]!.text).toContain("会员下单那条线");
    expect(turns[0]!.text).toContain("3 条");
    // 它不是一次模型回合，所以不许标成 fallback——那个标记的含义是「模型本该说话却没说成」。
    expect(turns[0]!.source).not.toBe("fallback");
  });

  it("导入之后线程又聊了几句 ⇒ 项目的 problem **不变**（一次性，不是订阅）", async () => {
    const { projects, chat } = seeded();
    const { d } = importDeps(projects, chat);

    await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-1", problem: "导入当时的背景" });
    chat.append("th-1", "另外我们还想加一个社交分享");
    chat.append("th-1", "对，社交分享很重要");

    // 没有任何东西会因为线程变了而回头改项目——读一次库就是最终答案。
    expect(projects.rows.get("dp-1")!.problem).toBe("导入当时的背景");
    const view = await listMyProjects(deps(projects), { ownerId: "u-owner" });
    // ⭐ 反证锚点：改成"每轮实时读线程" ⇒ 这条红。
    expect(view[0]!.problem).toBe("导入当时的背景");
    expect(view[0]!.problem).not.toContain("社交分享");
  });

  it("线程太长 ⇒ 按最近 N 条截断，truncated 为真，且**留痕里写明截断了**", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: "u-owner" }));
    const chat = new FakeChatThreadSource();
    const long = Array.from({ length: C.IMPORT_THREAD_MAX_MESSAGES + 5 }, (_, i) => `第 ${i} 句`);
    chat.seed(personalThread({ threadId: "th-long", createdBy: "u-owner", title: "很长的线", bodies: long }));
    const { d, model } = importDeps(projects, chat);

    const preview = await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-long" });
    expect(preview.truncated).toBe(true);
    expect(preview.imported.messageCount).toBe(C.IMPORT_THREAD_MAX_MESSAGES);
    // 取的是**最近** N 条：最早那几句不在喂给模型的正文里，最后一句在。
    const prompt = model.complete.mock.calls[0]![0]!.user;
    expect(prompt).not.toContain("第 0 句");
    expect(prompt).toContain(`第 ${long.length - 1} 句`);

    await importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-long", problem: "截断后的背景" });
    // ⭐ 反证锚点：静默截断（留痕里不写）⇒ 这条红。用户会以为模型看过它其实没看过的那段。
    expect(projects.rows.get("dp-1")!.chat[0]!.text).toContain("只读了最近");
  });

  it("摘要做不出来 ⇒ 报 DEPENDENCY_UNAVAILABLE 那一类，不给一段假摘要，项目不变", async () => {
    const { projects, chat } = seeded();
    const { d } = importDeps(projects, chat, async () => { throw new Error("model down"); });

    await expect(importThread(d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-1" }))
      .rejects.toBeInstanceOf(DesignThreadSummaryUnavailableError);
    expect(projects.rows.get("dp-1")!.problem).toBe("用户已经写好的背景");

    const empty = importDeps(projects, chat, async () => ({ text: "   " }));
    await expect(importThread(empty.d, { projectId: "dp-1", ownerId: "u-owner", threadId: "th-1" }))
      .rejects.toBeInstanceOf(DesignThreadSummaryUnavailableError);
  });
});
