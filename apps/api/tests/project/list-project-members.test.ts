/**
 * #609 UC-P9 `listProjectMembers` —— 成员名单读端点（**仅 `kind='workshop'`**）。
 *
 * ⚠ 本文件**不需要 Postgres**：用例是「`authorize()` 的判定 + 容器种类分支 + 一次仓储读」
 *   的纯编排，两个依赖都用内存替身（同 `role-view-fakes.ts` 文件头对 F04 的同一条理由）。
 *   真库那一侧的断言（SQL 谓词、JOIN、列集）在
 *   `list-project-members-repo-guard.test.ts` 里静态钉住。
 *
 * ## 本文件钉的是什么（每一条都写明「不做会怎样」）
 *
 *   ① **kind 不是 workshop ⇒ 不返回名单**（#609 的核心收窄，本文件的主反证）。
 *      不做：`research_project` / `user_insight` 的 tab 会拿到一个**空数组**，
 *      于是「这一类容器的名单还没被设计」这个缺口被渲染成「这个项目还没有人」——
 *      一个正常的空态，没有任何东西会报警。#609 逐字要求这两类显式显示
 *      「尚未建（设计缺口）」，不假装空列表。
 *   ② **非项目成员 ⇒ `NO_PROJECT_ROLE`，不是空数组**。
 *      不做：一次越权读静默通过，且「无权限」与「这个工作坊没有成员」不可分辨。
 *   ③ **四种角色（含 `observer`）都能读、且四种角色都出现在名单里**。
 *      不做：名单只回 facilitator，或观察者被挡——两者都与 #609 的裁决相反。
 *   ④ **判定服务不可用 ⇒ `AUTH_SERVICE_UNAVAILABLE`**，不降级放行。
 *   ⑤ 契约面：`out` 的四个字段与 `addProjectMember.out` **逐字同名**，
 *      且 `members` 可为 `null`。判定函数自己先在一个故意改名的 schema 上报红（反证），
 *      否则「同名」这条断言可能什么都没比。
 */
import { describe, expect, it } from "vitest";
import { project as C } from "@repo/contracts";
import { z } from "zod";
import {
  listProjectMembers,
  LIST_PROJECT_MEMBERS_ACTION,
  type ListProjectMembersDeps,
} from "../../src/application/project/list-project-members";
import type {
  ProjectMemberRosterEntry,
  ProjectMemberRosterRepository,
} from "../../src/application/project/member-ports";
import { ProjectError } from "../../src/application/project/errors";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import type { ProjectKind } from "../../src/domain/project/create-project-rules";
import { FakeDecisionIds, FakeRoleViewRepository, type FakeMembership } from "../support/role-view-fakes";

const ORG = toOrgId("org-609");
const WORKSHOP = "proj-609-workshop";
const RESEARCH = "proj-609-research";
const OTHER_WORKSHOP = "proj-609-other-workshop";

const ROSTER: Record<string, readonly ProjectMemberRosterEntry[]> = {
  [WORKSHOP]: [
    { userId: "u-facilitator", displayName: "梁引导", projectRole: "facilitator", isHost: true },
    { userId: "u-group-lead", displayName: "周组长", projectRole: "groupLead", isHost: false },
    { userId: "u-member", displayName: "陈组员", projectRole: "member", isHost: false },
    { userId: "u-observer", displayName: "吴观察", projectRole: "observer", isHost: false },
  ],
  // ⚠ 这个非工作坊容器**故意有成员行**：如果用例是靠「查出来是空的」而不是靠
  //   「压根不查」来返回 null，这里的数据会让它露馅。
  [RESEARCH]: [
    { userId: "u-owner", displayName: "研究负责人", projectRole: "facilitator", isHost: true },
  ],
  [OTHER_WORKSHOP]: [
    { userId: "u-outsider", displayName: "别的项目的人", projectRole: "member", isHost: false },
  ],
};

const KINDS: Record<string, ProjectKind> = {
  [WORKSHOP]: "workshop",
  [RESEARCH]: "research_project",
  [OTHER_WORKSHOP]: "workshop",
};

/** 记录每一次调用——「名单被查了没有」本身就是一条断言。 */
class FakeRosterRepository implements ProjectMemberRosterRepository {
  readonly kindCalls: Array<{ orgId: OrgId; projectId: string }> = [];
  readonly listCalls: Array<{ orgId: OrgId; projectId: string }> = [];

  async findProjectKind(orgId: OrgId, projectId: string): Promise<ProjectKind | null> {
    this.kindCalls.push({ orgId, projectId });
    return KINDS[projectId] ?? null;
  }

  async listWorkshopMembers(
    orgId: OrgId,
    projectId: string,
  ): Promise<readonly ProjectMemberRosterEntry[]> {
    this.listCalls.push({ orgId, projectId });
    return ROSTER[projectId] ?? [];
  }
}

const MEMBERS: Record<string, FakeMembership> = {
  "u-facilitator": { orgRole: "consultant", projectRole: "facilitator", isHost: true },
  "u-group-lead": { orgRole: "consultant", projectRole: "groupLead" },
  "u-member": { orgRole: "consultant", projectRole: "member" },
  "u-observer": { orgRole: "consultant", projectRole: "observer" },
  // 在组织里，但在这个项目里没有任何角色——I-P9 说的「正常状态」。
  "u-no-project-role": { orgRole: "consultant", projectRole: null },
};

function makeDeps(roster: ProjectMemberRosterRepository = new FakeRosterRepository()): ListProjectMembersDeps {
  return {
    auth: { repo: new FakeRoleViewRepository(MEMBERS), ids: new FakeDecisionIds() },
    roster,
  };
}

describe("① 反证（本 issue 的核心收窄）：kind 不是 workshop 时不返回名单", () => {
  it("research_project ⇒ members 为 null，而不是空数组", async () => {
    const roster = new FakeRosterRepository();
    const out = await listProjectMembers(makeDeps(roster), {
      userId: "u-facilitator",
      orgId: ORG,
      projectId: RESEARCH,
    });

    expect(out.members).toBeNull();
    // ⚠ `null` 与 `[]` 的区别就是本条断言的全部内容：空数组会把一个**设计缺口**
    //   （U-1 只裁了数据形状，没有契约操作）渲染成一个**正常的空态**。
    expect(out.members).not.toEqual([]);
  });

  it("非工作坊容器的名单**根本没被查**——不是查出来是空的", async () => {
    const roster = new FakeRosterRepository();
    await listProjectMembers(makeDeps(roster), {
      userId: "u-facilitator",
      orgId: ORG,
      projectId: RESEARCH,
    });

    // 非空转：容器种类确实被读了一次（否则下面那条「没查名单」可能只是因为整条路径没跑）。
    expect(roster.kindCalls).toEqual([{ orgId: ORG, projectId: RESEARCH }]);
    expect(roster.listCalls, "非工作坊容器不得去查成员名单").toEqual([]);
  });

  it("同一份替身里，工作坊容器**会**查名单 —— 证明上一条不是恒真", async () => {
    const roster = new FakeRosterRepository();
    const out = await listProjectMembers(makeDeps(roster), {
      userId: "u-facilitator",
      orgId: ORG,
      projectId: WORKSHOP,
    });

    expect(roster.listCalls).toEqual([{ orgId: ORG, projectId: WORKSHOP }]);
    expect(out.members).not.toBeNull();
  });

  it("那个非工作坊容器在替身里**确实有成员行** —— 否则本节全部空转", () => {
    expect(ROSTER[RESEARCH]!.length).toBeGreaterThan(0);
    expect(KINDS[RESEARCH]).not.toBe("workshop");
  });
});

describe("② 无权限与空名单必须可分辨", () => {
  it("组织内、但在这个项目里没有角色 ⇒ 抛 NO_PROJECT_ROLE，不是返回空数组", async () => {
    const roster = new FakeRosterRepository();
    await expect(
      listProjectMembers(makeDeps(roster), {
        userId: "u-no-project-role",
        orgId: ORG,
        projectId: WORKSHOP,
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });

    // 拒绝必须发生在读之前：越权请求不该触达名单查询。
    expect(roster.listCalls).toEqual([]);
  });

  it("容器不存在 ⇒ 同样是 NO_PROJECT_ROLE（存在性不得从外部分辨）", async () => {
    await expect(
      listProjectMembers(makeDeps(), {
        userId: "u-facilitator",
        orgId: ORG,
        projectId: "proj-609-does-not-exist",
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});

describe("③ 四种项目角色都能读，四种角色都在名单里", () => {
  it.each(["u-facilitator", "u-group-lead", "u-member", "u-observer"])(
    "%s 读得到名单（observer 亦可 —— #609 对模糊地带的明确补充）",
    async (userId) => {
      const out = await listProjectMembers(makeDeps(), { userId, orgId: ORG, projectId: WORKSHOP });
      expect(out.members).not.toBeNull();
      expect(out.members!.length).toBe(4);
    },
  );

  it("名单里四种角色都出现，且 displayName 是真名不是 userId", async () => {
    const out = await listProjectMembers(makeDeps(), {
      userId: "u-observer",
      orgId: ORG,
      projectId: WORKSHOP,
    });

    expect(new Set(out.members!.map((m) => m.projectRole))).toEqual(
      new Set(["facilitator", "groupLead", "member", "observer"]),
    );
    expect(out.members!.find((m) => m.userId === "u-facilitator")).toEqual({
      userId: "u-facilitator",
      displayName: "梁引导",
      projectRole: "facilitator",
      isHost: true,
    });
  });

  it("响应能过契约的 `out`（`.strict()`，多一个字段就会红）", async () => {
    const out = await listProjectMembers(makeDeps(), {
      userId: "u-member",
      orgId: ORG,
      projectId: WORKSHOP,
    });
    expect(() => C.operations.listProjectMembers.out.parse(out)).not.toThrow();
  });

  it("查的是被请求的那个项目 —— 不是「随便哪个工作坊」", async () => {
    const out = await listProjectMembers(makeDeps(), {
      userId: "u-facilitator",
      orgId: ORG,
      projectId: WORKSHOP,
    });
    expect(out.members!.some((m) => m.userId === "u-outsider")).toBe(false);
  });
});

describe("④ 判定服务不可用不得降级放行", () => {
  it("authorize 的依赖抛错 ⇒ AUTH_SERVICE_UNAVAILABLE，且不去查名单", async () => {
    const roster = new FakeRosterRepository();
    const brokenIdentity = new FakeRoleViewRepository(MEMBERS);
    brokenIdentity.findProjectMembership = async () => {
      throw new Error("identity service down");
    };

    const error = await listProjectMembers(
      { auth: { repo: brokenIdentity, ids: new FakeDecisionIds() }, roster },
      { userId: "u-facilitator", orgId: ORG, projectId: WORKSHOP },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProjectError);
    expect((error as ProjectError).reasonCode).toBe("AUTH_SERVICE_UNAVAILABLE");
    expect(roster.listCalls).toEqual([]);
  });
});

describe("⑤ 契约面：字段名不许长出第二份", () => {
  const rosterEntry = C.operations.listProjectMembers.out.shape.members.unwrap().element;

  /**
   * 「与 `addProjectMember.out` 逐字同名」的判定函数。先在一个故意改名的 schema 上
   * 报红（下一条），否则这条断言可能只是在比两个空集合。
   */
  const sharedFieldsMatch = (entry: z.AnyZodObject): boolean => {
    const write = C.operations.addProjectMember.out.shape;
    return (["userId", "projectRole", "isHost"] as const).every(
      (f) =>
        f in entry.shape &&
        JSON.stringify(zodShapeName(entry.shape[f]!)) === JSON.stringify(zodShapeName(write[f]!)),
    );
  };

  function zodShapeName(s: z.ZodTypeAny): unknown {
    const def = (s as unknown as { _def: { typeName: string; values?: unknown } })._def;
    return { typeName: def.typeName, values: def.values ?? null };
  }

  it("反证：把 userId 改名成 memberId 的 schema ⇒ 判定必须失败", () => {
    const renamed = z
      .object({
        memberId: z.string(),
        displayName: z.string(),
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
      })
      .strict();
    expect(sharedFieldsMatch(renamed)).toBe(false);
  });

  it("listProjectMembers.out.members[] 的三个共有字段与 addProjectMember.out 同名同型", () => {
    expect(sharedFieldsMatch(rosterEntry)).toBe(true);
    expect(Object.keys(rosterEntry.shape).sort()).toEqual(
      ["displayName", "isHost", "projectRole", "userId"].sort(),
    );
  });

  it("members 可为 null（非工作坊两类），空数组同样是合法的 200 体", () => {
    expect(C.operations.listProjectMembers.out.safeParse({ members: null }).success).toBe(true);
    expect(C.operations.listProjectMembers.out.safeParse({ members: [] }).success).toBe(true);
  });

  it("GET，与 addProjectMember 同路径不同方法；err 与 listAgendaSegments 同源", () => {
    expect(C.operations.listProjectMembers.method).toBe("GET");
    expect(C.operations.listProjectMembers.path).toBe(C.operations.addProjectMember.path);
    expect([...C.operations.listProjectMembers.err]).toEqual([
      "NO_PROJECT_ROLE",
      "AUTH_SERVICE_UNAVAILABLE",
    ]);
    // 动作词复用，不新造：与 `getProjectOverview` / `listAgendaSegments` 同一字面量。
    expect(LIST_PROJECT_MEMBERS_ACTION).toBe("read.published");
  });
});
