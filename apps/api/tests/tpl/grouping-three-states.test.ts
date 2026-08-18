import { describe, expect, it } from "vitest";
import {
  updateGroupingUseCase,
  UpdateGroupingError,
  canUpdateGrouping,
} from "../../src/application/templates/update-grouping";
import type {
  GroupingRepository,
  UpdateGroupingCommand,
  UpdatedGrouping,
} from "../../src/application/templates/grouping-ports";
import { GroupingRevisionConflictError } from "../../src/application/templates/grouping-ports";
import {
  GROUP_STATUSES,
  findGroupMissingLeader,
  findInvalidStatus,
  groupCountMatches,
  isValidGroupStatus,
  type GroupPatch,
} from "../../src/domain/templates/grouping";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f25-grouping");

/**
 * F25 —— **分组编排：组状态三值封闭 + 组长必填**（`uc-2-2` R8 V7）。
 *
 * 内存假仓储回显传入的分组并推进 revision，测试聚焦在用例层的三道门：
 * 角色 → 状态三值 → 组长必填，再落到仓储。
 */
class FakeGroupingRepository implements GroupingRepository {
  public calls: UpdateGroupingCommand[] = [];
  private revision = "rev-0";
  private shouldConflict = false;

  forceConflict(): void {
    this.shouldConflict = true;
  }

  async updateGrouping(cmd: UpdateGroupingCommand): Promise<UpdatedGrouping> {
    this.calls.push(cmd);
    if (this.shouldConflict) throw new GroupingRevisionConflictError();
    this.revision = `rev-${this.calls.length}`;
    this.lastGroups = cmd.groups;
    return { groups: cmd.groups, revision: this.revision };
  }

  private lastGroups: readonly GroupPatch[] = [];

  async getGrouping(): Promise<UpdatedGrouping> {
    return { groups: this.lastGroups, revision: this.revision };
  }
}

function group(overrides: Partial<GroupPatch> = {}): GroupPatch {
  return {
    groupId: "g-1",
    name: "第 1 组",
    scenario: "德国工商业主的采购决策链",
    leaderUserId: "u-lead",
    status: "recording-ready",
    memberUserIds: [],
    ...overrides,
  };
}

describe("F25 · 分组状态三值封闭（V7）", () => {
  it("三值恰好是原型的三态,不多不少", () => {
    expect([...GROUP_STATUSES].sort()).toEqual(
      ["needs-intervention", "recording-ready", "short-n"].sort(),
    );
  });

  it("三值之内的状态全部合法", () => {
    for (const s of GROUP_STATUSES) expect(isValidGroupStatus(s)).toBe(true);
  });

  it("第四态一律非法（不得自造第四态）", () => {
    expect(isValidGroupStatus("已完成")).toBe(false);
    expect(isValidGroupStatus("in-progress")).toBe(false);
  });

  it("构造三种组（录音就绪/缺 N 人/需介入），findInvalidStatus 对三者都放行", () => {
    const groups = [
      group({ groupId: "g-1", status: "recording-ready" }),
      group({ groupId: "g-2", status: "short-n" }),
      group({ groupId: "g-3", status: "needs-intervention" }),
    ];
    expect(findInvalidStatus(groups)).toBeUndefined();
  });

  it("`[− 4 +]` 增减组数后组卡数量一致时校验通过,不一致时校验失败", () => {
    const groups = [group({ groupId: "g-1" }), group({ groupId: "g-2" })];
    expect(groupCountMatches(2, groups)).toBe(true);
    expect(groupCountMatches(3, groups)).toBe(false);
    // 未显式设定组数 ⇒ 不做该项校验（低准备度态）。
    expect(groupCountMatches(null, groups)).toBe(true);
  });

  it("每组必须有组长——找出缺组长的那一组", () => {
    const groups = [
      group({ groupId: "g-1", leaderUserId: "u-1" }),
      group({ groupId: "g-2", leaderUserId: null }),
    ];
    expect(findGroupMissingLeader(groups)).toBe("g-2");
  });
});

describe("F25 · updateGrouping 用例", () => {
  it("facilitator 能保存三种状态的分组,`[加人]`/`[换组长]` 生效——仓储收到最终分组", async () => {
    const repo = new FakeGroupingRepository();
    const groups = [
      group({ groupId: "g-1", status: "recording-ready", leaderUserId: "u-1" }),
      group({ groupId: "g-2", status: "short-n", leaderUserId: "u-2" }),
      group({ groupId: "g-3", status: "needs-intervention", leaderUserId: "u-3" }),
    ];

    const out = await updateGroupingUseCase(
      { repo },
      {
        orgId: ORG, projectId: "p-1",
        actorProjectRole: "facilitator",
        groupCount: 3,
        groups,
        expectedRevision: "rev-0",
      },
    );

    expect(out.groups).toEqual(groups);
    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]?.groups.map((g) => g.status)).toEqual([
      "recording-ready",
      "short-n",
      "needs-intervention",
    ]);
  });

  it("groupLead/member/observer 不能编排分组 ⇒ ROLE_INSUFFICIENT（只有 facilitator 持有 `agendaSegment.group`）", async () => {
    const repo = new FakeGroupingRepository();
    for (const role of ["groupLead", "member", "observer"] as const) {
      expect(canUpdateGrouping(role)).toBe(false);
      await expect(
        updateGroupingUseCase(
          { repo },
          {
            orgId: ORG, projectId: "p-1",
            actorProjectRole: role,
            groupCount: 1,
            groups: [group()],
            expectedRevision: "rev-0",
          },
        ),
      ).rejects.toMatchObject(new UpdateGroupingError("ROLE_INSUFFICIENT"));
    }
    expect(repo.calls).toHaveLength(0);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const repo = new FakeGroupingRepository();
    await expect(
      updateGroupingUseCase(
        { repo },
        {
          orgId: ORG, projectId: "p-1",
          actorProjectRole: null,
          groupCount: 1,
          groups: [group()],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("NO_PROJECT_ROLE"));
  });

  it("第四态状态值 ⇒ INVALID_GROUP_STATUS,不落到仓储", async () => {
    const repo = new FakeGroupingRepository();
    await expect(
      updateGroupingUseCase(
        { repo },
        {
          orgId: ORG, projectId: "p-1",
          actorProjectRole: "facilitator",
          groupCount: 1,
          groups: [group({ status: "已完成" })],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("INVALID_GROUP_STATUS"));
    expect(repo.calls).toHaveLength(0);
  });

  it("缺组长的组 ⇒ GROUP_LEADER_REQUIRED,不落到仓储", async () => {
    const repo = new FakeGroupingRepository();
    await expect(
      updateGroupingUseCase(
        { repo },
        {
          orgId: ORG, projectId: "p-1",
          actorProjectRole: "facilitator",
          groupCount: 1,
          groups: [group({ leaderUserId: null })],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("GROUP_LEADER_REQUIRED"));
    expect(repo.calls).toHaveLength(0);
  });

  it("并发冲突 ⇒ VERSION_CHANGED", async () => {
    const repo = new FakeGroupingRepository();
    repo.forceConflict();
    await expect(
      updateGroupingUseCase(
        { repo },
        {
          orgId: ORG, projectId: "p-1",
          actorProjectRole: "facilitator",
          groupCount: 1,
          groups: [group()],
          expectedRevision: "rev-stale",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("VERSION_CHANGED"));
  });

  it("仓储读取失败 ⇒ DEPENDENCY_UNAVAILABLE,不吞成空结果", async () => {
    const repo: GroupingRepository = {
      updateGrouping: async () => {
        throw new Error("db down");
      },
      getGrouping: async () => {
        throw new Error("db down");
      },
    };
    await expect(
      updateGroupingUseCase(
        { repo },
        {
          orgId: ORG, projectId: "p-1",
          actorProjectRole: "facilitator",
          groupCount: 1,
          groups: [group()],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("DEPENDENCY_UNAVAILABLE"));
  });
});
