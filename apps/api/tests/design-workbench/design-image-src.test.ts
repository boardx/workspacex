/**
 * 深度 S10（#3988）—— 用户上传的图（image.src，data URL）：不进模型；模型写回之后按节点 id 补回。
 */
import { describe, expect, it } from "vitest";
import { appendProjectChat } from "../../src/application/design-workbench/append-project-chat";
import type { DesignProjectDeps } from "../../src/application/design-workbench/project-shared";
import type { DesignChatContext, DesignChatModel, DesignChatReplyResult } from "../../src/application/design-workbench/design-chat-model";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";
import { designPrototype, designWorkbench as C } from "@repo/contracts";

class FakeDesignChat implements DesignChatModel {
  readonly calls: DesignChatContext[] = [];
  answer: DesignChatReplyResult = { text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {}, suggestions: [] };
  async reply(ctx: DesignChatContext): Promise<DesignChatReplyResult> {
    this.calls.push(ctx);
    return this.answer;
  }
}

const deps = (projects: FakeDesignProjectRepo): DesignProjectDeps => ({
  projects, orgId: toOrgId("org-1"),
  submitters: { emailForUserId: async () => null, displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, id])) },
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const tree = (title: string, src?: string): designPrototype.PrototypeNode => ({
  id: "root", type: "stack", children: [
    { id: "img", type: "image", props: { alt: "商品主图", ...(src === undefined ? {} : { src }) } },
    { id: "t", type: "text", props: { content: title } },
  ],
});

function seeded(): FakeDesignProjectRepo {
  const repo = new FakeDesignProjectRepo();
  repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["首页"], prototype: [tree("旧标题", PNG)] }));
  return repo;
}

describe("深度 S10：上传的图与模型", () => {
  it("新增 HTML 页面保存交互说明，已有设计和上传图片原样保留", async () => {
    const repo = seeded();
    const ai = new FakeDesignChat();
    ai.answer = { text: "新增用户资料页。", source: "model", suggestions: [],
      writeback: { patch: [{ op: "addScreen", at: 1, frame: "用户资料", root: { type: "html", props: { html: "<div>用户资料</div>" } } }] },
      pageNotes: [{ screen: 1, notes: "点击AR名片进行扫描，扫描失败可以重试" }] };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "新增用户资料页" });
    expect(out.project.frames).toEqual(["首页", "用户资料"]);
    expect(out.project.prototype[0]).toEqual(tree("旧标题", PNG));
    expect(out.project.frameNotes[1]).toBe("点击AR名片进行扫描，扫描失败可以重试");
  });

  it("已有设计迭代的中间占位页不会覆盖原画布，模型失败后仍保留完整原型", async () => {
    const repo = seeded();
    const before = (await repo.get("dp-1"))!.prototype;
    const ai: DesignChatModel = { reply: async (ctx) => {
      await ctx.onProgress?.([{ frame: "首页" }]);
      expect((await repo.get("dp-1"))!.prototype).toEqual(before);
      return { text: "没能完成修改。", source: "fallback", writeback: {}, suggestions: [], fallbackReason: "MODEL_OUTPUT_TRUNCATED" };
    } };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "修改首页" });
    expect(out.project.prototype).toEqual(before);
    expect(out.reply.applied).toEqual([]);
  });

  it("模型看到的树（含选中的那个节点）里没有图的字节；整页重画回来，图按 id 补回", async () => {
    // ⭐ 反证锚点：去掉写回时的 `keepImages` ⇒ 这条红——用户上传的图在下一轮对话后悄悄没了。
    const repo = seeded();
    const ai = new FakeDesignChat();
    ai.answer = { text: "改好了。", source: "model", writeback: { prototype: [{ frame: "首页", root: tree("新标题") }] }, suggestions: [] };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "标题改一下", focusNodeId: "img" });
    expect(JSON.stringify(ai.calls[0]?.prototype)).not.toContain("base64");
    expect(JSON.stringify(ai.calls[0]?.focus)).not.toContain("base64");
    expect(out.project.prototype).toEqual([tree("新标题", PNG)]);
  });

  it("patch 里把图节点整个 replace 掉（同 id、没带 src）也补回；模型删掉的图不硬塞回去", async () => {
    const repo = seeded();
    const ai = new FakeDesignChat();
    ai.answer = { text: "换了说明。", source: "model", writeback: { patch: [{ op: "replace", id: "img", node: { id: "img", type: "image", props: { alt: "新说明" } } }] }, suggestions: [] };
    const out = await appendProjectChat({ ...deps(repo), ai }, { projectId: "dp-1", ownerId: "u-1", text: "改说明" });
    expect(out.project.prototype[0]).toMatchObject({ children: [{ id: "img", props: { alt: "新说明", src: PNG } }, { id: "t" }] });

    const drop = new FakeDesignChat();
    drop.answer = { text: "删了图。", source: "model", writeback: { patch: [{ op: "remove", id: "img" }] }, suggestions: [] };
    const out2 = await appendProjectChat({ ...deps(repo), ai: drop }, { projectId: "dp-1", ownerId: "u-1", text: "不要图了" });
    expect(JSON.stringify(out2.project.prototype)).not.toContain("base64");
  });
});
