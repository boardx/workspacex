/**
 * F125 UC-P9 `changeProjectRole` —— **下一次请求即生效**（Q-4③ 裁），不缓存跨请求的判定
 * 结论，不等会话过期，不等缓存 TTL。
 *
 * 反证方式（同 UC-00.3 R12 V7）：变更前后各发一次**独立**的读取（不复用同一个
 * `PermissionDecision`/判定对象），断言后一次立刻反映新角色。只断言「`changeProjectRole`
 * 调用成功」测不出这一点——一个把旧角色悄悄缓存到会话结束的实现，写操作本身照样能
 * 成功返回 200。
 *
 * 用一个共享的内存存储、两个薄适配器分别实现 `IdentityRepository`（读）与
 * `ProjectMembershipRepository`（写）——这样"下一次读"读到的必须是同一份存储，
 * 不经过任何独立的缓存层，最接近地模拟「没有跨请求缓存」这句话在没有真实 HTTP
 * 会话时的可测形态。
 */
import { describe, expect, it } from "vitest";
import { changeProjectRole } from "../../src/application/project/change-project-role";
import { toOrgId } from "../../src/domain/org-id";
import type {
  AclObjectRef,
  BindingRow,
  IdentityRepository,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";
import type { OrgId } from "../../src/domain/org-id";
import type { OrgRole } from "../../src/domain/identity/roles";
import { FakeProjectMembershipRepository } from "../support/member-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";

const ORG = toOrgId("f125-nrq-org");
const PROJECT = "f125-nrq-proj";
const FACILITATOR = "u-f125-nrq-facilitator";
const TARGET = "u-f125-nrq-target";

/**
 * `IdentityRepository` 的项目层读取，直接投影自本测试注入的 `FakeProjectMembershipRepository`
 * ——同一份存储，读写共用，中间没有任何东西能缓存住一次判定。
 */
class ProjectingIdentityRepository implements IdentityRepository {
  constructor(
    private readonly members: FakeProjectMembershipRepository,
    private readonly orgRoles: Readonly<Record<string, OrgRole>>,
  ) {}

  async findOrganization(): Promise<OrganizationRow | null> {
    return null;
  }
  async findOrgMembership(userId: string): Promise<OrgMembershipRow | null> {
    const role = this.orgRoles[userId];
    return role === undefined ? null : { orgRole: role, teamId: null };
  }
  async findProjectMembership(userId: string, projectId: string, _orgId: OrgId): Promise<ProjectMembershipRow | null> {
    const row = this.members.read(projectId, userId);
    if (row === null) return null;
    return { projectRole: row.projectRole, groupId: row.groupId, isHost: row.isHost };
  }
  async findBindings(_o: OrgId, _objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    return new Map();
  }
  async listMemberships(): Promise<readonly { orgId: string; orgRole: OrgRole }[]> {
    return [];
  }
  async ensurePersonalLocalOrg(): Promise<OrganizationRow> {
    throw new Error("not used by this fixture");
  }
  async findPersonalLocalOrg(): Promise<OrganizationRow | null> {
    return null;
  }
  async countOrgMembers(): Promise<number> {
    return 0;
  }
}

describe("F125 UC-P9 changeProjectRole：下一次请求即生效，不跨请求缓存", () => {
  it("变更后立刻用一次独立的读取判定，必须看到新角色——不是旧角色的缓存", async () => {
    const members = new FakeProjectMembershipRepository();
    members.seed({ projectId: PROJECT, userId: FACILITATOR, projectRole: "facilitator", isHost: false, groupId: null });
    members.seed({ projectId: PROJECT, userId: TARGET, projectRole: "member", isHost: false, groupId: null });

    const identity = new ProjectingIdentityRepository(members, {});
    const provenance = new FakeProvenanceWriter();

    // “第一次请求”：读一次 TARGET 当前的判定输入,验证起点确实是 member。
    const before = await identity.findProjectMembership(TARGET, PROJECT, ORG);
    expect(before?.projectRole).toBe("member");

    // “变更请求”：facilitator 把 TARGET 从 member 改成 observer。
    await changeProjectRole(
      { identity, members, provenance },
      { actorId: FACILITATOR, orgId: ORG, projectId: PROJECT, userId: TARGET, projectRole: "observer", isHost: false },
    );

    // “下一次请求”：一次全新的、独立的读取——不是复用上面 `before` 那个对象,
    // 也没有调用任何“使缓存失效”的方法。如果角色被缓存住,这里会读到旧的 member。
    const after = await identity.findProjectMembership(TARGET, PROJECT, ORG);
    expect(after?.projectRole).toBe("observer");

    // 反向对照：变更前的那次读取对象本身不会被就地篡改（不是同一个引用被动了手脚，
    // 而是“判定这件事”本身在两次调用之间没有被缓存）。
    expect(before?.projectRole).toBe("member");
  });

  it("V7 的另一半：变更前该角色能做的事，下一次请求立刻做不了了", async () => {
    const members = new FakeProjectMembershipRepository();
    members.seed({ projectId: PROJECT, userId: FACILITATOR, projectRole: "facilitator", isHost: false, groupId: null });
    // TARGET 起初也是 facilitator——按本判定的规则，任何一个 facilitator 都能管理成员。
    members.seed({ projectId: PROJECT, userId: TARGET, projectRole: "facilitator", isHost: false, groupId: null });

    const identity = new ProjectingIdentityRepository(members, {});
    const provenance = new FakeProvenanceWriter();

    // 撤销 TARGET 的 facilitator 身份，改成 observer。
    await changeProjectRole(
      { identity, members, provenance },
      { actorId: FACILITATOR, orgId: ORG, projectId: PROJECT, userId: TARGET, projectRole: "observer", isHost: false },
    );

    // 下一次请求：TARGET 尝试再去改别人的角色——必须立刻被拒，不等会话过期。
    await expect(
      changeProjectRole(
        { identity, members, provenance },
        { actorId: TARGET, orgId: ORG, projectId: PROJECT, userId: FACILITATOR, projectRole: "member", isHost: false },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });
});
