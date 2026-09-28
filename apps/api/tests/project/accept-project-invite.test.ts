/**
 * 项目中枢 R2 —— `acceptProjectInvite`：已登录组织成员用一条邀请链接把自己加进项目。
 *
 * 纯 application 层，喂 in-memory 假仓储（同 `manage-members-admin-org-role.test.ts` 的做法）：
 * 令牌四态的真判定住在 `pg-invite-link-repository.ts` 那一条 WHERE 里，由
 * `tests/auth/invite-onetime-used-by.test.ts` 对真实事务断言；这里断言的是**编排**——
 * 判定顺序、跨组织令牌、幂等、归档、以及落行用的是链接记录的角色而不是调用者自报的。
 */
import { describe, expect, it } from "vitest";
import { acceptProjectInvite } from "../../src/application/project/accept-project-invite";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type {
  ConsumeInviteLinkInput,
  ConsumeInviteLinkResult,
  InviteLinkRepository,
} from "../../src/application/auth/invite-link-ports";
import type {
  AddMemberCommand,
  AddMemberOutcome,
  ProjectMembershipRepository,
} from "../../src/application/project/member-ports";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-r2");
const OTHER_ORG = toOrgId("org-other");
const PROJECT = "p-r2";

class FakeLinks implements InviteLinkRepository {
  consumed: ConsumeInviteLinkInput[] = [];
  constructor(private readonly result: ConsumeInviteLinkResult) {}
  async consume(input: ConsumeInviteLinkInput): Promise<ConsumeInviteLinkResult> {
    this.consumed.push(input);
    return this.result;
  }
  issue(): never { throw new Error("not used"); }
  revoke(): never { throw new Error("not used"); }
  list(): never { throw new Error("not used"); }
}

class FakeMembers implements ProjectMembershipRepository {
  added: AddMemberCommand[] = [];
  constructor(private readonly outcome: AddMemberOutcome["kind"] = "added") {}
  async addMember(cmd: AddMemberCommand): Promise<AddMemberOutcome> {
    this.added.push(cmd);
    if (this.outcome === "added") {
      return { kind: "added", row: { projectId: cmd.projectId, userId: cmd.userId, projectRole: cmd.projectRole, isHost: cmd.isHost, groupId: cmd.groupId } };
    }
    return { kind: this.outcome } as AddMemberOutcome;
  }
  changeRole(): never { throw new Error("not used"); }
  removeMember(): never { throw new Error("not used"); }
}

const grantOk: ConsumeInviteLinkResult = {
  ok: true,
  consumedSingleUse: false,
  grant: { linkId: "l1", orgId: ORG, projectId: PROJECT, groupId: "g2", projectRole: "groupLead" },
};

function orgMember(userId: string) {
  return new FakeRoleViewRepository({ [userId]: { orgRole: "consultant", projectRole: null } });
}

describe("acceptProjectInvite：核销令牌 + 以链接记录的角色落成员行", () => {
  it("正路：组织成员 + 有效令牌 ⇒ 落一行，角色与组来自链接记录，不是调用者自报", async () => {
    const links = new FakeLinks(grantOk);
    const members = new FakeMembers();
    const out = await acceptProjectInvite(
      { links, members, identity: orgMember("u1") },
      { userId: "u1", orgId: ORG, token: "tok" },
    );
    expect(out).toEqual({ projectId: PROJECT, projectRole: "groupLead", groupId: "g2", alreadyMember: false });
    expect(links.consumed).toHaveLength(1);
    expect(links.consumed[0]!.principalId).toBe("u1");
    expect(members.added).toEqual([
      { orgId: ORG, projectId: PROJECT, userId: "u1", projectRole: "groupLead", isHost: false, groupId: "g2" },
    ]);
  });

  it("已经是成员 ⇒ 幂等：alreadyMember=true，不抛错", async () => {
    const out = await acceptProjectInvite(
      { links: new FakeLinks(grantOk), members: new FakeMembers("already-member"), identity: orgMember("u1") },
      { userId: "u1", orgId: ORG, token: "tok" },
    );
    expect(out.alreadyMember).toBe(true);
    expect(out.projectId).toBe(PROJECT);
  });

  it("不是本组织成员 ⇒ NO_ORG_MEMBERSHIP，且**不核销**令牌（判定顺序：先组织后令牌）", async () => {
    const links = new FakeLinks(grantOk);
    await expect(
      acceptProjectInvite(
        { links, members: new FakeMembers(), identity: new FakeRoleViewRepository({}) },
        { userId: "stranger", orgId: ORG, token: "tok" },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_ORG_MEMBERSHIP" });
    expect(links.consumed).toHaveLength(0);
  });

  it("令牌属于别的组织 ⇒ INVITE_NOT_FOUND，不落行", async () => {
    const members = new FakeMembers();
    await expect(
      acceptProjectInvite(
        {
          links: new FakeLinks({ ...grantOk, grant: { ...grantOk.grant, orgId: OTHER_ORG } }),
          members,
          identity: orgMember("u1"),
        },
        { userId: "u1", orgId: ORG, token: "tok" },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });
    expect(members.added).toHaveLength(0);
  });

  it.each([
    ["revoked", "LINK_REVOKED"],
    ["expired", "LINK_EXPIRED"],
    ["used", "LINK_ALREADY_USED"],
    ["not-found", "INVITE_NOT_FOUND"],
  ] as const)("令牌 %s ⇒ %s（F15 四态原样透传）", async (reason, code) => {
    await expect(
      acceptProjectInvite(
        { links: new FakeLinks({ ok: false, reason }), members: new FakeMembers(), identity: orgMember("u1") },
        { userId: "u1", orgId: ORG, token: "tok" },
      ),
    ).rejects.toMatchObject({ reasonCode: code });
  });

  it("没带令牌 ⇒ LINK_TOKEN_REQUIRED", async () => {
    await expect(
      acceptProjectInvite(
        { links: new FakeLinks(grantOk), members: new FakeMembers(), identity: orgMember("u1") },
        { userId: "u1", orgId: ORG, token: null },
      ),
    ).rejects.toBeInstanceOf(OrgAdminError);
  });

  it("项目已归档 ⇒ FORBIDDEN；项目不存在 ⇒ INVITE_NOT_FOUND", async () => {
    await expect(
      acceptProjectInvite(
        { links: new FakeLinks(grantOk), members: new FakeMembers("archived"), identity: orgMember("u1") },
        { userId: "u1", orgId: ORG, token: "tok" },
      ),
    ).rejects.toMatchObject({ reasonCode: "FORBIDDEN" });
    await expect(
      acceptProjectInvite(
        { links: new FakeLinks(grantOk), members: new FakeMembers("not-found"), identity: orgMember("u1") },
        { userId: "u1", orgId: ORG, token: "tok" },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });
  });
});
