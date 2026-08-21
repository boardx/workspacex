import { describe, expect, it } from "vitest";
import {
  getViewerOptionsUseCase,
  GetViewerOptionsError,
  projectGroupsForRole,
  toViewerOptions,
  promptTextForRole,
} from "../../src/application/live-collab/get-viewer-options";
import type { GroupingRepository, UpdatedGrouping } from "../../src/application/templates/grouping-ports";
import type { GroupPatch } from "../../src/domain/templates/grouping";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F02（phase-10 viewer-role 束）—— `tab-live.tsx` 视角切换器的服务端权威数据源。
 *
 * 越权路径调研结论（issue #1688 评论已同步）：`tab-live.tsx` 的 `computeViewerOptions`
 * 此前只是前端渲染判定，真正驱动它的 `getProjectGrouping` 对所有角色都返回全量分组
 * （含每组 `leaderUserId`/`memberUserIds`）——前端只是不渲染那个选项，越权数据本身
 * 已经在网络响应体里（UC-0.3 R5 明确禁止的「前端隐藏即安全」）。这份测试钉住新增的
 * 独立端点 `getViewerOptions`：`viewer-role/domain.md` 不变量 1/2/3/4。
 */
const ORG = toOrgId("org-f02-viewer-options");

class FakeGroupingRepository implements GroupingRepository {
  constructor(private readonly snapshot: UpdatedGrouping) {}

  async updateGrouping(): Promise<UpdatedGrouping> {
    throw new Error("not used in this test");
  }

  async getGrouping(): Promise<UpdatedGrouping> {
    return this.snapshot;
  }
}

function group(overrides: Partial<GroupPatch> = {}): GroupPatch {
  return {
    groupId: "g-1",
    name: "第 1 组",
    scenario: "德国工商业主的采购决策链",
    leaderUserId: "u-lead-1",
    status: "recording-ready",
    memberUserIds: ["u-member-1"],
    ...overrides,
  };
}

const GROUPS: readonly GroupPatch[] = [
  group({ groupId: "g-1", name: "第 1 组", leaderUserId: "u-lead-1", memberUserIds: ["u-member-1"] }),
  group({ groupId: "g-2", name: "第 2 组", leaderUserId: "u-lead-2", memberUserIds: ["u-member-2"] }),
  group({ groupId: "g-3", name: "第 3 组", leaderUserId: "u-lead-3", memberUserIds: ["u-member-3"] }),
];

describe("F02 · projectGroupsForRole / toViewerOptions（纯函数）", () => {
  it("facilitator：视角列表 = 全场 + 全部分组", () => {
    const scoped = projectGroupsForRole(GROUPS, "facilitator", null);
    const viewers = toViewerOptions("facilitator", scoped);
    expect(viewers.map((v) => v.id)).toEqual(["stage", "g-1", "g-2", "g-3"]);
  });

  it("observer：只有一个 stage 条目，不含任何 group（不变量 3）", () => {
    const scoped = projectGroupsForRole(GROUPS, "observer", null);
    const viewers = toViewerOptions("observer", scoped);
    expect(viewers).toEqual([{ id: "stage", kind: "stage", label: "主持台·全场" }]);
  });

  it("groupLead：只有自己那一组，不含 stage 条目（不变量 2/4）", () => {
    const scoped = projectGroupsForRole(GROUPS, "groupLead", "g-2");
    const viewers = toViewerOptions("groupLead", scoped);
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toMatchObject({ id: "g-2", kind: "group" });
    expect(viewers.some((v) => v.kind === "stage")).toBe(false);
  });

  it("member：同 groupLead，只有自己那一组", () => {
    const scoped = projectGroupsForRole(GROUPS, "member", "g-3");
    const viewers = toViewerOptions("member", scoped);
    expect(viewers.map((v) => v.id)).toEqual(["g-3"]);
  });

  it("groupLead/member 找不到本组 ⇒ 空列表，不是全量兜底", () => {
    expect(toViewerOptions("groupLead", projectGroupsForRole(GROUPS, "groupLead", null))).toEqual([]);
    expect(toViewerOptions("member", projectGroupsForRole(GROUPS, "member", null))).toEqual([]);
  });

  it("groupLead 的视角条目里不出现别组的 leaderUserId/memberUserIds", () => {
    const scoped = projectGroupsForRole(GROUPS, "groupLead", "g-2");
    const viewers = toViewerOptions("groupLead", scoped);
    const serialized = JSON.stringify(viewers);
    expect(serialized).not.toContain("u-lead-1");
    expect(serialized).not.toContain("u-lead-3");
  });

  it("四角色提示条文案各不相同（不是所有角色都显示引导师那句『你有全部权限』）", () => {
    const texts = (["facilitator", "groupLead", "member", "observer"] as const).map(promptTextForRole);
    expect(new Set(texts).size).toBe(3); // groupLead/member 共享同一句「只能看自己所在的分组」
    expect(promptTextForRole("facilitator")).toContain("全部权限");
    expect(promptTextForRole("observer")).not.toContain("全部权限");
    expect(promptTextForRole("groupLead")).not.toContain("全部权限");
  });
});

describe("F02 · getViewerOptionsUseCase（服务端拒绝面）", () => {
  it("未传 requestedViewerId：只读角色范围内的视角列表", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    const out = await getViewerOptionsUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "groupLead", actorGroupId: "g-2" },
    );
    expect(out.role).toBe("groupLead");
    expect(out.viewers.map((v) => v.id)).toEqual(["g-2"]);
  });

  it("observer 请求 requestedViewerId=\"stage\" ⇒ 放行（唯一合法视角）", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    const out = await getViewerOptionsUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "observer", actorGroupId: null, requestedViewerId: "stage" },
    );
    expect(out.viewers).toHaveLength(1);
  });

  it("observer 改参数请求某个分组 id（'别组的分组视角'）⇒ VIEWER_SCOPE_DENIED，不是 200 + 空数据", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    await expect(
      getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: "observer", actorGroupId: null, requestedViewerId: "g-1" },
      ),
    ).rejects.toMatchObject(new GetViewerOptionsError("VIEWER_SCOPE_DENIED"));
  });

  it("member 改参数请求『主持台·全场』(\"stage\") ⇒ VIEWER_SCOPE_DENIED", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    await expect(
      getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: "member", actorGroupId: "g-1", requestedViewerId: "stage" },
      ),
    ).rejects.toMatchObject(new GetViewerOptionsError("VIEWER_SCOPE_DENIED"));
  });

  it("groupLead 改参数请求别组 id ⇒ VIEWER_SCOPE_DENIED", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    await expect(
      getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: "groupLead", actorGroupId: "g-1", requestedViewerId: "g-2" },
      ),
    ).rejects.toMatchObject(new GetViewerOptionsError("VIEWER_SCOPE_DENIED"));
  });

  it("groupLead 请求自己那组的 id ⇒ 放行", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    const out = await getViewerOptionsUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "groupLead", actorGroupId: "g-1", requestedViewerId: "g-1" },
    );
    expect(out.viewers.map((v) => v.id)).toEqual(["g-1"]);
  });

  it("facilitator 请求任意分组或 stage 都放行", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    for (const requestedViewerId of ["stage", "g-1", "g-2", "g-3"]) {
      const out = await getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: "facilitator", actorGroupId: null, requestedViewerId },
      );
      expect(out.viewers.some((v) => v.id === requestedViewerId)).toBe(true);
    }
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const repo = new FakeGroupingRepository({ groups: GROUPS, revision: "rev-1" });
    await expect(
      getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: null, actorGroupId: null },
      ),
    ).rejects.toMatchObject(new GetViewerOptionsError("NO_PROJECT_ROLE"));
  });

  it("仓储读取失败 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const repo: GroupingRepository = {
      updateGrouping: async () => {
        throw new Error("db down");
      },
      getGrouping: async () => {
        throw new Error("db down");
      },
    };
    await expect(
      getViewerOptionsUseCase(
        { repo },
        { orgId: ORG, projectId: "p-1", actorProjectRole: "facilitator", actorGroupId: null },
      ),
    ).rejects.toMatchObject(new GetViewerOptionsError("DEPENDENCY_UNAVAILABLE"));
  });
});
