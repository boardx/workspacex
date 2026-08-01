/**
 * F125 UC-P9 `addProjectMember` —— **两个入口共用同一个 application 用例**（Q-4① 裁 B）。
 *
 * 反证方式：分别以 `subject.kind: "orgUser"` 与 `subject.kind: "inviteToken"` 调用同一个
 * `addProjectMember()`，断言两次都落在**同一个** `ProjectMembershipRepository.addMember()`
 * 调用与**同一个**审计写入上——而不是分别断言「两条路径各自都能把人加进去」（那样即使
 * 背后是两套互相独立的实现，也会全绿，测不出「共用」这句话）。
 *
 * 另外断言：`inviteToken` 路径的角色/host 取**服务端记录值**，请求体里声明的值被丢弃——
 * 这是「两个入口共用一个用例」防的那类越权：持一枚「组员」邀请码的人不能在核销请求里把
 * 自己声明成 `facilitator`。
 *
 * 不需要真实 Postgres：`addProjectMember` 是对 `IdentityRepository` / `ProjectMembershipRepository`
 * / `MemberSubjectResolver` 的纯编排，同 F04 `role-view-fakes.ts` 的理由。
 */
import { describe, expect, it } from "vitest";
import { addProjectMember } from "../../src/application/project/add-project-member";
import { ProjectMemberAlreadyExistsError } from "../../src/application/project/errors";
import { FakeMemberSubjectResolver, FakeProjectMembershipRepository } from "../support/member-fakes";
import { FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("f125-org");
const PROJECT = "f125-proj-1";
const FACILITATOR = "u-f125-facilitator";

function makeDeps(identityMembers: ConstructorParameters<typeof FakeRoleViewRepository>[0]) {
  const identity = new FakeRoleViewRepository(identityMembers);
  const members = new FakeProjectMembershipRepository();
  const resolver = new FakeMemberSubjectResolver({
    "tok-groupLead": { userId: "u-f125-bob", projectId: PROJECT, projectRole: "groupLead", groupId: "g1" },
  });
  const provenance = new FakeProvenanceWriter();
  return { identity, members, resolver, provenance };
}

describe("F125 UC-P9 addProjectMember：两个入口，一个用例", () => {
  it("orgUser 直接指派 与 inviteToken 邀请核销 —— 落库调用与审计事件都经过同一段代码", async () => {
    const deps = makeDeps({
      [FACILITATOR]: { orgRole: null, projectRole: "facilitator" },
    });

    const orgUserResult = await addProjectMember(deps, {
      actorId: FACILITATOR,
      orgId: ORG,
      projectId: PROJECT,
      subject: { kind: "orgUser", ref: "u-f125-alice" },
      projectRole: "member",
      isHost: false,
    });
    expect(orgUserResult.userId).toBe("u-f125-alice");
    expect(orgUserResult.projectRole).toBe("member");

    const inviteResult = await addProjectMember(deps, {
      actorId: FACILITATOR,
      orgId: ORG,
      projectId: PROJECT,
      subject: { kind: "inviteToken", ref: "tok-groupLead" },
      // ⚠ 请求体声明的角色/host 必须被忽略 —— 见下方断言。
      projectRole: "facilitator",
      isHost: true,
    });
    expect(inviteResult.userId).toBe("u-f125-bob");
    // 服务端记录值（链接签发时锁定的 groupLead），不是请求体里的 facilitator。
    expect(inviteResult.projectRole).toBe("groupLead");
    // invite_links 没有 is_host 列，恒为 false —— 不是请求体的 true。
    expect(inviteResult.isHost).toBe(false);

    // 核心断言：两次调用都落在**同一个**仓储方法上，不是两条各自维护的写入路径。
    expect(deps.members.addCalls).toHaveLength(2);
    expect(deps.members.addCalls[0]).toMatchObject({
      userId: "u-f125-alice", projectRole: "member", isHost: false, groupId: null,
    });
    expect(deps.members.addCalls[1]).toMatchObject({
      userId: "u-f125-bob", projectRole: "groupLead", isHost: false, groupId: "g1",
    });

    // 两次都写了同一类型的审计事件（role-changed / target.kind=membership），只有
    // detail.subjectKind 不同 —— 证明审计路径也没有分岔成两套。
    expect(deps.provenance.appended).toHaveLength(2);
    for (const evt of deps.provenance.appended) {
      expect(evt.type).toBe("role-changed");
      expect(evt.target.kind).toBe("membership");
    }
    expect(deps.provenance.appended[0]!.detail.subjectKind).toBe("orgUser");
    expect(deps.provenance.appended[1]!.detail.subjectKind).toBe("inviteToken");
  });

  it("两条入口共用同一个授予者判定 —— 无权限的人从两条入口拿到的是同一种拒绝", async () => {
    const deps = makeDeps({
      "u-f125-bystander": { orgRole: "consultant", projectRole: "member" },
    });

    await expect(
      addProjectMember(deps, {
        actorId: "u-f125-bystander",
        orgId: ORG,
        projectId: PROJECT,
        subject: { kind: "orgUser", ref: "u-f125-someone" },
        projectRole: "member",
        isHost: false,
      }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });

    await expect(
      addProjectMember(deps, {
        actorId: "u-f125-bystander",
        orgId: ORG,
        projectId: PROJECT,
        subject: { kind: "inviteToken", ref: "tok-groupLead" },
        projectRole: "member",
        isHost: false,
      }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });

    // 判定在写入之前就已经拒绝 —— 仓储从未被调用过。
    expect(deps.members.addCalls).toHaveLength(0);
  });

  it("重复添加同一个人 —— 主键冲突落成不带 reasonCode 的错误（契约未命名此码）", async () => {
    const deps = makeDeps({ [FACILITATOR]: { orgRole: null, projectRole: "facilitator" } });
    deps.members.seed({
      projectId: PROJECT, userId: "u-f125-dup", projectRole: "member", isHost: false, groupId: null,
    });

    await expect(
      addProjectMember(deps, {
        actorId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        subject: { kind: "orgUser", ref: "u-f125-dup" },
        projectRole: "observer",
        isHost: false,
      }),
    ).rejects.toBeInstanceOf(ProjectMemberAlreadyExistsError);
  });
});
