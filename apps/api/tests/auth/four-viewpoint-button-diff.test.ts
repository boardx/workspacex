/**
 * F04 — 四视角界面裁剪：同一套屏按项目角色裁剪（UC-1.4 R3/R5/R8，AC1 + AC3）。
 *
 * V1: 四种项目角色请求**同一个页面路由**均返回同一套骨架（`screen` / `slots` 不随角色变化）。
 * V3: 可执行动作端点（按钮）集合满足严格递减链——
 *     引导师 ⊇ 组长 ⊃ 组员 ⊃ 观察者，且观察者集合为**空集**。
 *
 * ## 为什么 observer 的「按钮集为空」与 domain 层 `PROJECT_ROLE_MATRIX.observer` 非空不矛盾
 *
 * 矩阵里 observer 那一行是 `["read.published"]`——不是空的，因为观察者确实允许一项读取。
 * AC3 说的是**按钮**（写端点），不是这个角色的全部动作集合。`actionEndpointsFor` 只取非
 * `read.*` 的动作，这正是本测试断言的对象；见 `domain/identity/role-view.ts` 头部说明。
 *
 * 本文件不导入 `tests/support/db`：`renderRoleView` 是 `authorize()` 的决定 + 纯矩阵查表的
 * 投影，用内存版 `IdentityRepository`（`tests/support/role-view-fakes.ts`）即可完整测试，
 * 不需要真实 PostgreSQL。
 */
import { describe, expect, it } from "vitest";
import { identity as I } from "@repo/contracts";
import { renderRoleView } from "../../src/application/project/render-role-view";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-f04-role-view");
const PROJECT = "proj-f04-role-view";
const SCREEN = "project-workbench";

const USERS = {
  facilitator: "u-f04-facilitator",
  groupLead: "u-f04-grouplead",
  member: "u-f04-member",
  observer: "u-f04-observer",
} as const;

function repoWith() {
  return new FakeRoleViewRepository({
    [USERS.facilitator]: { orgRole: "consultant", projectRole: "facilitator", groupId: null, isHost: true },
    [USERS.groupLead]: { orgRole: "consultant", projectRole: "groupLead", groupId: "g2" },
    [USERS.member]: { orgRole: "consultant", projectRole: "member", groupId: "g2" },
    [USERS.observer]: { orgRole: "consultant", projectRole: "observer", groupId: null },
  });
}

async function viewFor(role: keyof typeof USERS) {
  const deps = { repo: repoWith(), ids: new FakeDecisionIds() };
  return renderRoleView(deps, {
    userId: USERS[role],
    orgId: ORG,
    projectId: PROJECT,
    screen: SCREEN,
  });
}

describe("AC1: 同一路由，四种角色返回同一套骨架", () => {
  it("skeleton 的 screen 与 slots 逐字相同，不随角色变化", async () => {
    const roles = Object.keys(USERS) as (keyof typeof USERS)[];
    const skeletons = await Promise.all(roles.map((r) => viewFor(r).then((v) => v.skeleton)));
    for (const s of skeletons) {
      expect(s).toEqual(skeletons[0]);
    }
    // 非空转：确实渲染了内容，不是四个都恰好是同一个空骨架的巧合。
    expect(skeletons[0]!.slots.length).toBeGreaterThan(0);
  });

  it("四种角色请求都判定为 allowed（同一屏对四个角色都是「有权限进这套屏」）", async () => {
    const roles = Object.keys(USERS) as (keyof typeof USERS)[];
    for (const r of roles) {
      const v = await viewFor(r);
      expect(v.decision.allowed, r).toBe(true);
    }
  });
});

describe("AC3: 按钮集差集 —— 引导师 ⊇ 组长 ⊃ 组员 ⊃ 观察者 = ∅", () => {
  it("观察者的按钮集恰好是空集", async () => {
    const v = await viewFor("observer");
    expect(v.actionEndpoints).toEqual([]);
  });

  it("组员的按钮集是组长按钮集的**真**子集（组长恰好多，不是相等）", async () => {
    const groupLead = new Set((await viewFor("groupLead")).actionEndpoints);
    const member = new Set((await viewFor("member")).actionEndpoints);
    for (const a of member) expect(groupLead.has(a), a).toBe(true);
    expect(groupLead.size).toBeGreaterThan(member.size);
  });

  it("组长的按钮集是引导师按钮集的子集（引导师⊇组长）", async () => {
    const facilitator = new Set((await viewFor("facilitator")).actionEndpoints);
    const groupLead = new Set((await viewFor("groupLead")).actionEndpoints);
    for (const a of groupLead) expect(facilitator.has(a), a).toBe(true);
  });

  it("组员的按钮集非空（组员⊃观察者是真超集，不是两边都是空集）", async () => {
    const member = (await viewFor("member")).actionEndpoints;
    expect(member.length).toBeGreaterThan(0);
  });

  it("反证：四个角色的按钮集互不相同（防「谁都拿同一个常量数组」）", async () => {
    const roles = Object.keys(USERS) as (keyof typeof USERS)[];
    const serialized = await Promise.all(
      roles.map(async (r) => JSON.stringify([...(await viewFor(r)).actionEndpoints].sort())),
    );
    expect(new Set(serialized).size).toBe(roles.length);
  });
});

describe("按契约闭集穷举：`identity.ProjectRole` 只有四个值", () => {
  it("四值恰好覆盖本文件测的四个角色（第五个角色出现时本文件会漏测）", () => {
    expect(I.ProjectRole.options.length).toBe(4);
    const testedRoles = new Set<string>(["facilitator", "groupLead", "member", "observer"]);
    expect(testedRoles).toEqual(new Set(I.ProjectRole.options));
  });
});
