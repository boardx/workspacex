/**
 * #614 —— `authorizeManageMembers` 路径②的组织角色判据从「仅 `lead`」放宽到
 * 「`lead` 或 `admin`」（人类裁决 2026-08-06，与 #608 同型）。
 *
 * ## 为什么这条需要单独一个 issue，而不是 #608 顺手带上
 *
 * #608 实测把「建项目」这道门打开之后，紧接着撞上下一道门：
 *   `POST /projects` → 201 成功
 *   `POST /projects/:id/members`（创建者把自己加进去）→ 403 `ORG_ROLE_INSUFFICIENT`
 * 根因是**同一族但不同的判据**：`authorizeManageMembers` 只放行「项目 facilitator」
 * 或「组织 `lead`」——没有 `admin`。与 `list-projects.ts:84` 早已有的先例
 * （`isManager = orgRole === "lead" || orgRole === "admin"`）不一致。
 *
 * ## 🔴 三件不同的事——本文件只钉第 2 件，且要证明另外两件没被动
 *
 *   1. 能不能建项目（`canCreateProject`，#608）—— 本文件不测，已在
 *      `bootstrap-admin-can-create-project.test.ts` 钉住。
 *   2. **能不能调用「管理项目成员」这个动作**（本函数，#614）—— 本文件的主题。
 *   3. 建项目会不会自动拥有项目角色（Q-4②）—— **必须仍然不会**，见下方
 *      「护栏」describe：本文件唯一新增的写操作断言。
 *
 * ⚠ 不写 `expect(status).toBeGreaterThanOrEqual(400)` / 只断言路由存在这类空转形状——
 *   每条都点名 `reasonCode`，且都配放行的正样本（同一份判据既能拒也能放，
 *   只测一半只会证明「这个函数至少做了点什么」）。
 */
import { describe, expect, it } from "vitest";
import { authorizeManageMembers } from "../../src/application/project/member-authorization";
import { addProjectMember } from "../../src/application/project/add-project-member";
import type { AddProjectMemberDeps } from "../../src/application/project/add-project-member";
import type {
  AddMemberCommand,
  AddMemberOutcome,
  ChangeRoleCommand,
  ChangeRoleOutcome,
  MemberSubjectResolver,
  ProjectMembershipRepository,
  RemoveMemberCommand,
  RemoveMemberOutcome,
  ResolvedInviteGrant,
} from "../../src/application/project/member-ports";
import { FakeRoleViewRepository, FakeProvenanceWriter } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("f125-614-org");
const PROJECT = "f125-614-proj-unjoined";

class FakeMembershipRepo implements ProjectMembershipRepository {
  added: AddMemberCommand[] = [];
  async addMember(cmd: AddMemberCommand): Promise<AddMemberOutcome> {
    this.added.push(cmd);
    return {
      kind: "added",
      row: { projectId: cmd.projectId, userId: cmd.userId, projectRole: cmd.projectRole, isHost: cmd.isHost, groupId: cmd.groupId },
    };
  }
  async changeRole(_cmd: ChangeRoleCommand): Promise<ChangeRoleOutcome> {
    throw new Error("not used by #614 fixtures");
  }
  async removeMember(_cmd: RemoveMemberCommand): Promise<RemoveMemberOutcome> {
    throw new Error("not used by #614 fixtures");
  }
}

class NullSubjectResolver implements MemberSubjectResolver {
  async resolveInviteToken(): Promise<ResolvedInviteGrant | null> {
    throw new Error("not used by #614 fixtures — orgUser subject only");
  }
}

describe("#614：路径② —— 组织角色 `admin` 现在也放行", () => {
  it("放行：组织角色 `admin`、无项目角色 —— 与 `lead` 走同一条路径②", async () => {
    const identity = new FakeRoleViewRepository({
      "u-614-admin": { orgRole: "admin", projectRole: null },
    });
    await expect(
      authorizeManageMembers(identity, { actorId: "u-614-admin", orgId: ORG, projectId: PROJECT }),
    ).resolves.toBeUndefined();
  });

  it("正样本对照：`lead` 依旧放行（#614 是放宽，不是替换）", async () => {
    const identity = new FakeRoleViewRepository({
      "u-614-lead": { orgRole: "lead", projectRole: null },
    });
    await expect(
      authorizeManageMembers(identity, { actorId: "u-614-lead", orgId: ORG, projectId: PROJECT }),
    ).resolves.toBeUndefined();
  });

  it("负样本：另两种组织角色仍被拒，点名 `ORG_ROLE_INSUFFICIENT` —— 不许退化成「谁都能管」", async () => {
    for (const role of ["consultant", "compliance"] as const) {
      const identity = new FakeRoleViewRepository({
        [`u-614-${role}`]: { orgRole: role, projectRole: null },
      });
      await expect(
        authorizeManageMembers(identity, { actorId: `u-614-${role}`, orgId: ORG, projectId: PROJECT }),
      ).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });
    }
  });

  it("负样本：无组织身份也无项目角色 ⇒ `NO_PROJECT_ROLE`（I-P9 正常状态，不是被本次改动动过的边）", async () => {
    const identity = new FakeRoleViewRepository({});
    await expect(
      authorizeManageMembers(identity, { actorId: "u-614-nobody", orgId: ORG, projectId: PROJECT }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  /**
   * 🟡 已有项目角色（非 facilitator）时，组织 `admin`/`lead` 是否应当被那个角色「盖住」——
   * 本函数自己的头注写着「这条**不**因为组织角色是 `lead` 而被覆盖」，但**实测当前实现
   * 对 `lead` 就已经是覆盖的**（同一 fixture 探测：`orgRole:"lead", projectRole:"member"`
   * ⇒ 放行，不是 `PROJECT_ROLE_INSUFFICIENT`）。这是 F125（#231，唯一一次改动本文件的提交）
   * 从一开始就有的文档/实现不一致，**与 #614 无关**——#614 只是把 `admin` 接到与 `lead`
   * 完全相同的那条分支上，因此 `admin` 与 `lead` 在这一格上**行为对称**，
   * 不多不少地复刻了既有的（有争议的）行为，不是本次改动新引入的偏差。
   * ⇒ 本文件只钉「对称」，不裁「谁的文档错了」——那是一个独立发现，已在 PR 正文报告。
   */
  it("已有项目角色但不是 facilitator：组织 `admin` 与既有 `lead` 行为对称（都放行，是否应当放行是另一个问题）", async () => {
    const leadIdentity = new FakeRoleViewRepository({
      "u-614-member-lead": { orgRole: "lead", projectRole: "member" },
    });
    const adminIdentity = new FakeRoleViewRepository({
      "u-614-member-admin": { orgRole: "admin", projectRole: "member" },
    });
    const leadResult = await authorizeManageMembers(leadIdentity, {
      actorId: "u-614-member-lead", orgId: ORG, projectId: PROJECT,
    }).then(() => "resolved", (e: { reasonCode: string }) => e.reasonCode);
    const adminResult = await authorizeManageMembers(adminIdentity, {
      actorId: "u-614-member-admin", orgId: ORG, projectId: PROJECT,
    }).then(() => "resolved", (e: { reasonCode: string }) => e.reasonCode);
    expect(adminResult).toBe(leadResult);
  });
});

describe("端到端一小段：admin 通过判定后，真的能把自己加进项目", () => {
  it("`addProjectMember` 用例：admin 调用成功，`project_memberships` 真的多了一行", async () => {
    const identity = new FakeRoleViewRepository({
      "u-614-admin-e2e": { orgRole: "admin", projectRole: null },
    });
    const members = new FakeMembershipRepo();
    const deps: AddProjectMemberDeps = {
      identity,
      members,
      resolver: new NullSubjectResolver(),
      provenance: new FakeProvenanceWriter(),
    };

    const out = await addProjectMember(deps, {
      orgId: ORG,
      actorId: "u-614-admin-e2e",
      projectId: PROJECT,
      subject: { kind: "orgUser", ref: "u-614-admin-e2e" },
      projectRole: "facilitator",
      isHost: true,
    });

    expect(out.userId).toBe("u-614-admin-e2e");
    expect(members.added).toHaveLength(1);
    expect(members.added[0]).toMatchObject({ projectId: PROJECT, userId: "u-614-admin-e2e", projectRole: "facilitator" });
  });
});

describe("🔴 护栏：Q-4② 没有被 #614 破坏 —— 光是「能建项目」不产生任何 project_memberships 行", () => {
  it("`authorizeManageMembers` 本身从不读写 project_memberships —— 它只判『能不能调用』", async () => {
    // FakeRoleViewRepository 的 findProjectMembership 只读注入的 fixture，本函数没有任何
    // 写路径可以触达；这里用一个"建了项目但没有项目角色"的 admin 复现 #608 之后的真实状态，
    // 断言路径②放行本身不隐含"现在这个人已经有项目角色了"——放行只是"可以去调用
    // addProjectMember"，不是"已经是成员"。
    const identity = new FakeRoleViewRepository({
      "u-614-guard": { orgRole: "admin", projectRole: null },
    });
    await authorizeManageMembers(identity, { actorId: "u-614-guard", orgId: ORG, projectId: PROJECT });
    // 放行之后，同一个 identity 上再查一次项目成员关系——仍然是 null。
    const membership = await identity.findProjectMembership("u-614-guard");
    expect(membership).toBeNull();
  });
});
