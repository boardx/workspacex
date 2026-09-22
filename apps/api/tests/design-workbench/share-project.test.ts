/**
 * 迭代 22 —— 发布与分享的用例级正反例，全部走内存 fake（不碰数据库）。
 *
 * 这一套要钉住的核心只有一句：**发出去的链接是一份冻结的快照，而且它冻住了什么、
 * 没冻住什么，都要能被机械地验出来**。屏上那句"已分享"如果对不上事实，它就是本仓
 * 点名过的「静态痕迹」——写下来就不再变，而画布早改了三轮。
 */
import { describe, expect, it } from "vitest";
import { designPrototype } from "@repo/contracts";
import {
  NothingToPublishError,
  ShareNotFoundError,
  getSharedDesign,
  makeShareToken,
  parseShareToken,
  publishProject,
  unpublishProject,
} from "../../src/application/design-workbench/share-project";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  loadProjectView,
  type DesignProjectDeps,
} from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";

const OWNER = "u-owner";
const ORG = "org-1";

const screen = (label: string): designPrototype.PrototypeNode => ({
  type: "stack",
  id: `s-${label}`,
  children: [
    { type: "navbar", id: `nav-${label}`, props: { title: label } },
    { type: "button", id: `btn-${label}`, props: { label: "继续", variant: "primary" } },
  ],
});

function drawnRow(over: Parameters<typeof designProjectRow>[0] = {}) {
  return designProjectRow({
    ownerId: OWNER,
    name: "外卖下单",
    frames: ["首页", "下单"],
    prototype: [screen("首页"), screen("下单")],
    frameNotes: ["首屏即可下单", ""],
    frameLinks: [[{ from: "btn-首页", to: 1 }], []],
    problem: "内部立项背景：某客户抱怨结算太慢",
    criteria: ["三步内完成下单"],
    ...over,
  });
}

function deps(projects: FakeDesignProjectRepo): DesignProjectDeps {
  return {
    projects,
    orgId: toOrgId(ORG),
    submitters: {
      emailForUserId: async () => null,
      displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, `名字-${id}`])),
    },
  };
}

/** 发布 + 把令牌拿出来（令牌只对 owner 返回，所以这里按 owner 读）。 */
async function publishAndToken(projects: FakeDesignProjectRepo, scope?: "prototype" | "full") {
  const { project } = await publishProject(deps(projects), {
    projectId: "dp-1",
    ownerId: OWNER,
    ...(scope === undefined ? {} : { scope }),
  });
  const token = project.share?.token;
  expect(token, "owner 读自己的项目应该拿得到令牌").toBeTypeOf("string");
  return { project, token: token! };
}

/** 公开读只需要仓储工厂——它没有 principal，组织是从令牌里来的。 */
const publicDeps = (projects: FakeDesignProjectRepo) => ({
  projects: { forOrg: () => projects },
  submitters: {
    emailForUserId: async () => null,
    displayNamesForUserIds: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `名字-${id}`])),
  },
});

describe("发布", () => {
  it("一页都没画出来 ⇒ 拒绝发布，而不是发一条打开是白屏的链接", async () => {
    /*
     * ⭐ 反证锚点：去掉 `hasDrawnScreen` 那道判断 ⇒ 这条红。
     * 允许发空链接的表现是：对方打开看到一片空白，只会以为链接坏了——而链接是好的，
     * 坏的是"发布"这个动作在这一刻没有意义。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ ownerId: OWNER, frames: ["首页"], prototype: [null] }));
    await expect(publishProject(deps(projects), { projectId: "dp-1", ownerId: OWNER })).rejects.toBeInstanceOf(NothingToPublishError);
  });

  it("不是 owner 不能发布；项目不存在报的是另一个码", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await expect(publishProject(deps(projects), { projectId: "dp-1", ownerId: "u-other" })).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    await expect(publishProject(deps(projects), { projectId: "nope", ownerId: OWNER })).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });

  it("默认档是保守的那一档：不把内部立项背景一起发出去", async () => {
    /*
     * ⭐ 反证锚点：把默认改成 `full` ⇒ 这条红。
     * `problem` 很可能是 `importThread` 从一条内部对话线程导进来的，里面带着立项背景、
     * 内部吐槽、客户名字。"把原型发给外部评审"和"把立项讨论发给外部评审"是两件事。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { token } = await publishAndToken(projects);
    const { design } = await getSharedDesign(publicDeps(projects), token);
    expect(design.problem).toBeNull();
    expect(design.criteria).toBeNull();
    expect(JSON.stringify(design)).not.toContain("某客户");
  });

  it("选了 full 档才带上问题与验收标准", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { token } = await publishAndToken(projects, "full");
    const { design } = await getSharedDesign(publicDeps(projects), token);
    expect(design.problem).toContain("某客户");
    expect(design.criteria).toEqual(["三步内完成下单"]);
  });

  it("重新发布**不换链接**——发出去的那条在别人聊天记录里，你收不回来", async () => {
    /*
     * ⭐ 反证锚点：把仓储那句 `COALESCE(share_token, $4)` 改成直接覆盖 ⇒ 这条红。
     * 表现是：你点了一次"更新发布"，昨天发给评审的链接从此打不开，而屏上什么都不说。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const first = await publishAndToken(projects);
    const again = await publishAndToken(projects);
    expect(again.token).toBe(first.token);
  });

  it("档位不给 ⇒ 沿用上一次那档，不悄悄退回默认", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await publishAndToken(projects, "full");
    const { project } = await publishProject(deps(projects), { projectId: "dp-1", ownerId: OWNER });
    expect(project.share?.scope).toBe("full");
  });
});

describe("发出去的是快照，不是活链接", () => {
  it("发布之后改画布，访客看到的仍是发布那一刻的那一份", async () => {
    /*
     * ⭐ 反证锚点：把公开读改成读当前行而不是读快照 ⇒ 这条红。
     *
     * 这不是假想的场景：原型是**分页渐进落库**的（`persistProgress` 每画完一页写一次库），
     * 活链接意味着评审在你重新生成的那三十秒里刷新一下，看到的是三页空白加一页画到一半。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { token } = await publishAndToken(projects);

    await projects.update("dp-1", OWNER, { frames: ["全新的一页"], prototype: [screen("全新")] });
    const { design } = await getSharedDesign(publicDeps(projects), token);
    expect(design.frames).toEqual(["首页", "下单"]);
    expect(design.frameLinks[0]).toEqual([{ from: "btn-首页", to: 1 }]);
  });

  it("快照与画布分叉 ⇒ owner 读到 `stale: true`（屏上据此说「更新发布」）", async () => {
    /*
     * ⭐ 反证锚点：去掉 `isShareStale` 的比对、让它恒 false ⇒ 这条红。
     * 那正是本仓那条「静态痕迹 ≠ 动态事实」：界面上留下"已分享"，而画布还在继续改，
     * 两边都不会发现对方看到的是三轮之前。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await publishAndToken(projects);
    expect((await loadProjectView(deps(projects), "dp-1", OWNER)).share?.stale).toBe(false);

    await projects.update("dp-1", OWNER, { problem: "改了背景" });
    expect((await loadProjectView(deps(projects), "dp-1", OWNER)).share?.stale).toBe(true);
  });

  it("只改了标签这类不进快照的东西 ⇒ 不亮 stale（天天亮着的信号等于没有信号）", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await publishAndToken(projects);
    await projects.update("dp-1", OWNER, { tags: ["后台"] });
    expect((await loadProjectView(deps(projects), "dp-1", OWNER)).share?.stale).toBe(false);
  });
});

describe("取消发布", () => {
  it("链接立刻失效，且再次发布会换一条新的（「收回」要真的收回）", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { token } = await publishAndToken(projects);

    const { project } = await unpublishProject(deps(projects), { projectId: "dp-1", ownerId: OWNER });
    expect(project.share).toBeNull();
    await expect(getSharedDesign(publicDeps(projects), token)).rejects.toBeInstanceOf(ShareNotFoundError);

    const again = await publishAndToken(projects);
    expect(again.token).not.toBe(token);
    // ⭐ 反证锚点：留着旧令牌只挂一个"已撤销"标志 ⇒ 上面那条 rejects 变绿失败。
    await expect(getSharedDesign(publicDeps(projects), token)).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it("没发布过也返回 200——幂等，重试不该变成一件要理解的事", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { project } = await unpublishProject(deps(projects), { projectId: "dp-1", ownerId: OWNER });
    expect(project.share).toBeNull();
  });

  it("不是 owner 不能取消发布", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await publishAndToken(projects);
    await expect(unpublishProject(deps(projects), { projectId: "dp-1", ownerId: "u-other" })).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });
});

describe("令牌", () => {
  it("locator 解得出 org 与项目；改一个字符就解不出或对不上", () => {
    const token = makeShareToken(ORG, "dp-1");
    expect(parseShareToken(token)).toEqual([ORG, "dp-1"]);
    expect(parseShareToken("不是令牌")).toBeNull();
    expect(parseShareToken("")).toBeNull();
    // 只有 locator 没有密钥 ⇒ 无效（密钥那一半才是门）
    expect(parseShareToken(token.split(".")[0]!)).toBeNull();
    expect(parseShareToken(`${"A".repeat(3000)}.x`)).toBeNull();
  });

  it("locator 对、密钥不对 ⇒ 和「令牌不存在」是同一个出口", async () => {
    /*
     * ⭐ 反证锚点：把密钥比对去掉、只按 locator 查 ⇒ 这条红，而那意味着
     * 任何知道 orgId 和 projectId 的人都能读到别人的原型（两个 id 都会出现在 URL 里）。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    const { token } = await publishAndToken(projects);
    const forged = `${token.split(".")[0]!}.${"x".repeat(43)}`;
    await expect(getSharedDesign(publicDeps(projects), forged)).rejects.toBeInstanceOf(ShareNotFoundError);
    await expect(getSharedDesign(publicDeps(projects), "垃圾")).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it("令牌只给 owner——组织里别人看得见这个项目，但拿不到往外发的凭证", async () => {
    /*
     * ⭐ 反证锚点：把 `shareView` 的 viewer 判断去掉 ⇒ 这条红。
     * "组织内全员可读"说的是看得见这个项目，不是可以替 owner 把它发到组织外面去。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow());
    await publishAndToken(projects);
    const asOther = await loadProjectView(deps(projects), "dp-1", "u-other");
    expect(asOther.share).not.toBeNull();
    expect(asOther.share?.token).toBeNull();
    // 但"已经发布了"这件事本身不藏——同组的人该知道这个项目在外面有链接。
    expect(asOther.share?.publishedAt).toBeTypeOf("string");
  });
});

describe("公开投影不许带出内部信息", () => {
  it("对话、参考图、owner id、来源反馈、issue、推送态，一个都不在", async () => {
    /*
     * ⭐ 反证锚点：在 `getSharedDesign` 的返回里加上 `chat` ⇒ 这条红。
     * 契约那侧有一条字段闭集断言守静态形状，这里守**运行期真的返回了什么**——
     * 两条缺一不可：契约那条挡"类型上多了一个字段"，这条挡"类型没变但值漏了出去"。
     */
    const projects = new FakeDesignProjectRepo();
    projects.seed(drawnRow({ chat: [{ role: "user", text: "老板说这版不行", at: "2026-09-22T00:00:00.000Z" }] }));
    const { token } = await publishAndToken(projects, "full");
    const { design } = await getSharedDesign(publicDeps(projects), token);
    const json = JSON.stringify(design);
    expect(json).not.toContain("老板说这版不行");
    for (const k of ["chat", "refImages", "ownerId", "linkedFeedbackId", "githubIssueUrl", "pushed", "tags"]) {
      expect(Object.keys(design), `${k} 不该随分享链接出去`).not.toContain(k);
    }
    // 该带的要带：访客得知道自己看的是谁发的、哪一版。
    expect(design.ownerName).toBe(`名字-${OWNER}`);
    expect(design.publishedAt).toBeTypeOf("string");
  });
});
