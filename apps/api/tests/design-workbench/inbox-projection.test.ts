/**
 * UC-17.8 B4.3 —— `buildDesignInboxItems` 单独测——过滤/编号/`body` 回退规则,
 * 不经过完整的 `listInbox`（那部分的聚合已在 `tests/inbox/list-inbox.test.ts` 覆盖）。
 */
import { describe, expect, it } from "vitest";
import { buildDesignInboxItems } from "../../src/application/inbox/inbox-projection";
import type { DesignProjectView } from "../../src/application/design-workbench/project-shared";

function designView(over: Partial<DesignProjectView> = {}): DesignProjectView {
  return {
    id: "dp-1",
    name: "项目 A",
    template: "wireframe",
    theme: "dark",
    accent: "neutral",
    tokens: { brand: null, font: "sans", radius: "default", density: "default" },
    tags: [],
    refImages: [],
    share: null,
    problem: "",
    criteria: [],
    frames: [],
    prototype: [],
    frameNotes: [],
    pushed: true,
    pushedAt: "2026-09-04T00:00:00.000Z",
    linkedFeedbackId: null,
    githubIssueUrl: null,
    githubIssueNumber: null,
    chat: [],
    ownerId: "u-1",
    ownerName: "张三",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

describe("buildDesignInboxItems", () => {
  it("开发排期携带完整设计、交互、验收与对话，原 HTML 不截断，发布令牌不随交付暴露", () => {
    const html = `<style>.page{color:purple}</style><div>${"完整细节".repeat(1000)}<button>AR 扫描</button></div>`;
    const view = designView({ frames: ["AR 用户资料"], prototype: [{ id: "p0", type: "html", props: { html } }],
      frameNotes: ["扫描成功后打开用户资料"], frameLinks: [[]], criteria: ["AR 扫描失败时可以重试"],
      chat: [{ role: "user", text: "保留个人资料与AR名片", at: "2026-10-13T01:00:00Z" }],
      share: { token: "private-publishing-token", scope: "full", publishedAt: "2026-10-13T01:00:00Z", stale: false } });
    const item = buildDesignInboxItems([view])[0]!.item;
    expect(item.design).toEqual({ ...view, share: null });
    expect(JSON.stringify(item.design)).toContain(html.replace(/"/g, '\\"'));
    expect(item.design!.frameNotes).toEqual(view.frameNotes);
    expect(item.design!.criteria).toEqual(view.criteria);
    expect(item.design!.chat).toEqual(view.chat);
    expect(item.design!.share).toBeNull();
    expect(JSON.stringify(item.design)).not.toContain("private-publishing-token");
  });

  it("未推送的项目不出现", () => {
    const out = buildDesignInboxItems([designView({ id: "dp-1", pushed: false })]);
    expect(out).toHaveLength(0);
  });

  it("stage 恒 backlog，kind 恒 design", () => {
    const out = buildDesignInboxItems([designView()]);
    expect(out[0]!.item.stage).toBe("backlog");
    expect(out[0]!.item.kind).toBe("design");
  });

  it("body 回退到 problem，都为空则 null", () => {
    const withProblem = buildDesignInboxItems([designView({ id: "dp-1", problem: "登录页崩溃" })]);
    expect(withProblem[0]!.item.body).toBe("登录页崩溃");

    const empty = buildDesignInboxItems([designView({ id: "dp-2", problem: "" })]);
    expect(empty[0]!.item.body).toBeNull();
  });

  it("reporter 取 ownerName，linkedFeedbackId 透传，resolvedByDesignId 恒 null", () => {
    const out = buildDesignInboxItems([designView({ ownerName: "李四", linkedFeedbackId: "fb-9" })]);
    expect(out[0]!.item.reporter).toBe("李四");
    expect(out[0]!.item.linkedFeedbackId).toBe("fb-9");
    expect(out[0]!.item.resolvedByDesignId).toBeNull();
  });

  it("编号 D-n 只在已推送的行里按创建顺序赋号", () => {
    const out = buildDesignInboxItems([
      designView({ id: "dp-2", createdAt: "2026-09-02T00:00:00.000Z" }),
      designView({ id: "dp-1", createdAt: "2026-09-01T00:00:00.000Z" }),
      designView({ id: "dp-3", pushed: false, createdAt: "2026-09-03T00:00:00.000Z" }),
    ]);
    const byId = new Map(out.map((k) => [k.item.id, k.item.code]));
    expect(byId.get("dp-1")).toBe("D-1");
    expect(byId.get("dp-2")).toBe("D-2");
    expect(byId.get("dp-3")).toBeUndefined();
  });
});

describe("buildDesignInboxItems -- 2026-09-05「转开发」：stage 与 github 由有没有 issue 派生", () => {
  it("没有 issue ⇒ stage=backlog、github=null、sourceStatus=已推送", () => {
    const out = buildDesignInboxItems([designView()]);
    expect(out[0]!.item.stage).toBe("backlog");
    expect(out[0]!.item.github).toBeNull();
    expect(out[0]!.item.sourceStatus).toBe("已推送");
  });

  it("有 issue ⇒ stage=doing、github 是那张 issue、sourceStatus=已转开发", () => {
    const out = buildDesignInboxItems([
      designView({ githubIssueUrl: "https://github.com/o/r/issues/77", githubIssueNumber: 77 }),
    ]);
    expect(out[0]!.item.stage).toBe("doing");
    expect(out[0]!.item.github).toEqual({
      kind: "issue",
      number: 77,
      url: "https://github.com/o/r/issues/77",
      // 恒 open——没有对账来源能说它关没关，见契约 InboxGithubRef 头注那条已登记缺口。
      state: "open",
    });
    expect(out[0]!.item.sourceStatus).toBe("已转开发");
  });

  it("url/number 只有一半（不该发生，但形状要挡住）⇒ 徽标、stage、sourceStatus 三者一致地当作没有 issue", () => {
    for (const half of [
      { githubIssueUrl: "https://x/1", githubIssueNumber: null },
      { githubIssueUrl: null, githubIssueNumber: 5 },
    ]) {
      const out = buildDesignInboxItems([designView(half)]);
      expect(out[0]!.item.github).toBeNull();
      // 看板上绝不能出现「已转开发但没有票」的卡片——三处读同一个判断。
      expect(out[0]!.item.stage).toBe("backlog");
      expect(out[0]!.item.sourceStatus).toBe("已推送");
    }
  });
});
