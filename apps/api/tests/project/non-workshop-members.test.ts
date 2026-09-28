/**
 * 项目中枢 B3-T5（#4499）—— 研究项目 / 用户洞察两类容器成员三个用例的**编排**断言，
 * 喂 in-memory 假仓储（同 `project-resources.test.ts` 的做法）。SQL 那一侧（两张表分派、
 * upsert、RLS、JOIN credentials）由 `non-workshop-members-pg.test.ts` 对真实 PostgreSQL 断言。
 *
 * 钉住：
 *   · owner 可加 / 可删；collaborator 不可（PROJECT_ROLE_INSUFFICIENT）；名单两档都能读；
 *   · 容器无 owner 时组织 lead/admin 可加第一位；有了 owner 之后同一个 lead 再加 ⇒ ORG_ROLE_INSUFFICIENT；
 *   · 不在组织里 ⇒ NO_PROJECT_ROLE；容器不存在 ⇒ NO_PROJECT_ROLE（不可分辨）；
 *   · 工作坊容器 ⇒ ProjectKindMismatchError（组织成员）/ NO_PROJECT_ROLE（外人，探不到 kind）；
 *   · 目标人不是组织成员 ⇒ ORG_ROLE_INSUFFICIENT 且不写；
 *   · 再 add 一次 = 改档，不报错；删不存在的人 ⇒ 幂等成功、removed:false、不写审计；
 *   · 已归档 ⇒ PROJECT_ARCHIVED，不写；判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE；
 *   · 审计写 role-changed / membership，复合 id；
 *   · 契约面：三个操作的 err 都是 ProjectReason 的成员，`role` 取值与 NonWorkshopMemberRole 同源。
 */
import { describe, expect, it } from "vitest";
import { project as C } from "@repo/contracts";
import { listNonWorkshopMembers } from "../../src/application/project/list-non-workshop-member";
import { addNonWorkshopMember } from "../../src/application/project/add-non-workshop-member";
import { removeNonWorkshopMember } from "../../src/application/project/remove-non-workshop-member";
import type {
  NonWorkshopContainer,
  NonWorkshopKind,
  NonWorkshopMemberRepository,
  NonWorkshopMemberRole,
  NonWorkshopMemberRow,
  NonWorkshopStanding,
  RemoveNonWorkshopMemberOutcome,
  UpsertNonWorkshopMemberOutcome,
} from "../../src/application/project/non-workshop-member-ports";
import { ProjectKindMismatchError } from "../../src/application/project/errors";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-b3t5");
const RESEARCH = "p-research";
const INSIGHT = "p-insight";
const WORKSHOP = "p-workshop";
const ARCHIVED = "p-archived";

class FakeMembers implements NonWorkshopMemberRepository {
  readonly containers = new Map<string, NonWorkshopContainer>([
    [RESEARCH, { kind: "research_project", status: "active" }],
    [INSIGHT, { kind: "user_insight", status: "active" }],
    [WORKSHOP, { kind: "workshop", status: "active" }],
    [ARCHIVED, { kind: "research_project", status: "archived" }],
  ]);
  /** `projectId` → `userId` → role；两张表在这里是两个 kind 前缀的键。 */
  readonly rows = new Map<string, Map<string, NonWorkshopMemberRole>>();
  readonly listCalls: string[] = [];

  seed(projectId: string, userId: string, role: NonWorkshopMemberRole): void {
    if (!this.rows.has(projectId)) this.rows.set(projectId, new Map());
    this.rows.get(projectId)!.set(userId, role);
  }
  async findContainer(_o: OrgId, projectId: string): Promise<NonWorkshopContainer | null> {
    return this.containers.get(projectId) ?? null;
  }
  async findStanding(_o: OrgId, projectId: string, _k: NonWorkshopKind, userId: string): Promise<NonWorkshopStanding> {
    const m = this.rows.get(projectId) ?? new Map<string, NonWorkshopMemberRole>();
    return { memberRole: m.get(userId) ?? null, containerHasOwner: [...m.values()].includes("owner") };
  }
  async listMembers(_o: OrgId, projectId: string): Promise<Guarded<readonly NonWorkshopMemberRow[]>> {
    this.listCalls.push(projectId);
    const m = this.rows.get(projectId) ?? new Map<string, NonWorkshopMemberRole>();
    return guard(
      { kind: "project", id: projectId },
      [...m.entries()].map(([userId, role]) => ({ userId, displayName: `name-${userId}`, role })),
    );
  }
  async upsertMember(cmd: { projectId: string; userId: string; role: NonWorkshopMemberRole }): Promise<UpsertNonWorkshopMemberOutcome> {
    const c = this.containers.get(cmd.projectId);
    if (c === undefined) return { kind: "not-found" };
    if (c.status === "archived") return { kind: "archived" };
    this.seed(cmd.projectId, cmd.userId, cmd.role);
    return { kind: "written", role: cmd.role };
  }
  async removeMember(cmd: { projectId: string; userId: string }): Promise<RemoveNonWorkshopMemberOutcome> {
    return this.rows.get(cmd.projectId)?.delete(cmd.userId) ? "removed" : "absent";
  }
}

const identity = new FakeRoleViewRepository({
  owner: { orgRole: "consultant", projectRole: null },
  collab: { orgRole: "consultant", projectRole: null },
  colleague: { orgRole: "consultant", projectRole: null },
  lead: { orgRole: "lead", projectRole: null },
  admin: { orgRole: "admin", projectRole: null },
  outsider: { orgRole: null, projectRole: null },
});

function deps(members: FakeMembers, repo: IdentityRepository = identity) {
  return { identity: repo, ids: new FakeDecisionIds(), members, provenance: new FakeProvenanceWriter() };
}
const actor = (actorId: string, projectId = RESEARCH) => ({ actorId, orgId: ORG, projectId });

function seeded(): FakeMembers {
  const m = new FakeMembers();
  m.seed(RESEARCH, "owner", "owner");
  m.seed(RESEARCH, "collab", "collaborator");
  m.seed(INSIGHT, "owner", "owner");
  m.seed(ARCHIVED, "owner", "owner");
  return m;
}

describe("listNonWorkshopMembers：名单上的人与组织管理者可读", () => {
  it("owner / collaborator / 组织 lead / admin 都能读；两类容器各自分派", async () => {
    const m = seeded();
    for (const u of ["owner", "collab", "lead", "admin"]) {
      const out = await listNonWorkshopMembers(deps(m), actor(u));
      expect(out.members.map((x) => `${x.userId}:${x.role}`).sort()).toEqual(["collab:collaborator", "owner:owner"]);
    }
    const insight = await listNonWorkshopMembers(deps(m), actor("owner", INSIGHT));
    expect(insight.members).toEqual([{ userId: "owner", displayName: "name-owner", role: "owner" }]);
  });

  it("在组织里但不在名单上 ⇒ NO_PROJECT_ROLE，且不去查名单；不在组织里 ⇒ 同码", async () => {
    const m = seeded();
    await expect(listNonWorkshopMembers(deps(m), actor("colleague"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listNonWorkshopMembers(deps(m), actor("outsider"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    expect(m.listCalls).toEqual([]);
  });

  it("容器不存在 ⇒ NO_PROJECT_ROLE（与「没有角色」不可分辨）", async () => {
    await expect(listNonWorkshopMembers(deps(seeded()), actor("owner", "nope"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("工作坊容器：组织成员 ⇒ ProjectKindMismatchError（400 不带码）；外人 ⇒ NO_PROJECT_ROLE，探不到 kind", async () => {
    const m = seeded();
    await expect(listNonWorkshopMembers(deps(m), actor("colleague", WORKSHOP))).rejects.toBeInstanceOf(ProjectKindMismatchError);
    await expect(listNonWorkshopMembers(deps(m), actor("outsider", WORKSHOP))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE，不降级放行", async () => {
    const broken: IdentityRepository = Object.assign(Object.create(identity), {
      findOrgMembership: async () => { throw new Error("pg down"); },
    });
    await expect(listNonWorkshopMembers(deps(seeded(), broken), actor("owner"))).rejects.toMatchObject({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" });
  });
});

describe("addNonWorkshopMember：owner 才能加；空 owner 时 lead/admin 加第一位", () => {
  it("owner 加同事为 collaborator ⇒ 写入 + 审计（role-changed / membership，复合 id）", async () => {
    const m = seeded();
    const d = deps(m);
    const out = await addNonWorkshopMember(d, { ...actor("owner"), userId: "colleague", role: "collaborator" });
    expect(out).toEqual({ projectId: RESEARCH, userId: "colleague", role: "collaborator", provenanceEventId: expect.any(String) });
    expect(m.rows.get(RESEARCH)!.get("colleague")).toBe("collaborator");
    expect(d.provenance.appended).toHaveLength(1);
    expect(d.provenance.appended[0]).toMatchObject({
      type: "role-changed",
      actorId: "owner",
      target: { kind: "membership", id: `${RESEARCH}:colleague` },
      detail: { op: "non-workshop-member-upserted", containerKind: "research_project", role: "collaborator" },
    });
  });

  it("collaborator 不能加 ⇒ PROJECT_ROLE_INSUFFICIENT，不写", async () => {
    const m = seeded();
    await expect(addNonWorkshopMember(deps(m), { ...actor("collab"), userId: "colleague", role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    expect(m.rows.get(RESEARCH)!.has("colleague")).toBe(false);
  });

  it("容器没有任何 owner：lead / admin 可加第一位（通常是自己）；有了 owner 之后同一个 lead 再加 ⇒ ORG_ROLE_INSUFFICIENT", async () => {
    const m = new FakeMembers();
    const out = await addNonWorkshopMember(deps(m), { ...actor("lead"), userId: "lead", role: "owner" });
    expect(out.role).toBe("owner");
    // 旁路只在空 owner 时开着：另一个 admin 现在不在名单上，也不能再进来。
    await expect(addNonWorkshopMember(deps(m), { ...actor("admin"), userId: "admin", role: "owner" })).rejects.toMatchObject({
      reasonCode: "ORG_ROLE_INSUFFICIENT",
    });
    // 只有 collaborator（没有 owner）的容器仍算「没有 owner」。
    const onlyCollab = new FakeMembers();
    onlyCollab.seed(RESEARCH, "collab", "collaborator");
    await expect(addNonWorkshopMember(deps(onlyCollab), { ...actor("admin"), userId: "admin", role: "owner" })).resolves.toMatchObject({ role: "owner" });
  });

  it("不在名单上的普通组织成员 ⇒ ORG_ROLE_INSUFFICIENT；不在组织里 ⇒ NO_PROJECT_ROLE", async () => {
    const m = seeded();
    await expect(addNonWorkshopMember(deps(m), { ...actor("colleague"), userId: "colleague", role: "owner" })).rejects.toMatchObject({
      reasonCode: "ORG_ROLE_INSUFFICIENT",
    });
    await expect(addNonWorkshopMember(deps(m), { ...actor("outsider"), userId: "outsider", role: "owner" })).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });

  it("目标人不是组织成员 ⇒ ORG_ROLE_INSUFFICIENT，不写", async () => {
    const m = seeded();
    await expect(addNonWorkshopMember(deps(m), { ...actor("owner"), userId: "outsider", role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "ORG_ROLE_INSUFFICIENT",
    });
    expect(m.rows.get(RESEARCH)!.has("outsider")).toBe(false);
  });

  it("再 add 一次同一人 = 改档，不报错", async () => {
    const m = seeded();
    const out = await addNonWorkshopMember(deps(m), { ...actor("owner"), userId: "collab", role: "owner" });
    expect(out.role).toBe("owner");
    expect(m.rows.get(RESEARCH)!.get("collab")).toBe("owner");
  });

  it("工作坊容器 ⇒ ProjectKindMismatchError；已归档 ⇒ PROJECT_ARCHIVED，都不写", async () => {
    const m = seeded();
    const d = deps(m);
    await expect(addNonWorkshopMember(d, { ...actor("lead", WORKSHOP), userId: "lead", role: "owner" })).rejects.toBeInstanceOf(ProjectKindMismatchError);
    await expect(addNonWorkshopMember(d, { ...actor("owner", ARCHIVED), userId: "colleague", role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "PROJECT_ARCHIVED",
    });
    expect(d.provenance.appended).toHaveLength(0);
  });
});

describe("removeNonWorkshopMember：owner 才能删；幂等", () => {
  it("owner 删 collaborator ⇒ removed:true + 审计", async () => {
    const m = seeded();
    const d = deps(m);
    const out = await removeNonWorkshopMember(d, { ...actor("owner"), userId: "collab" });
    expect(out).toEqual({ projectId: RESEARCH, userId: "collab", removed: true, provenanceEventId: expect.any(String) });
    expect(m.rows.get(RESEARCH)!.has("collab")).toBe(false);
    expect(d.provenance.appended[0]).toMatchObject({ type: "role-changed", detail: { op: "non-workshop-member-removed" } });
  });

  it("被移除的 userId 不在名单上 ⇒ 幂等成功、removed:false、provenanceEventId null、不写审计", async () => {
    const m = seeded();
    const d = deps(m);
    const out = await removeNonWorkshopMember(d, { ...actor("owner"), userId: "nobody" });
    expect(out).toEqual({ projectId: RESEARCH, userId: "nobody", removed: false, provenanceEventId: null });
    expect(d.provenance.appended).toHaveLength(0);
  });

  it("collaborator 不能删 ⇒ PROJECT_ROLE_INSUFFICIENT；已归档 ⇒ PROJECT_ARCHIVED", async () => {
    const m = seeded();
    await expect(removeNonWorkshopMember(deps(m), { ...actor("collab"), userId: "owner" })).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(removeNonWorkshopMember(deps(m), { ...actor("owner", ARCHIVED), userId: "owner" })).rejects.toMatchObject({ reasonCode: "PROJECT_ARCHIVED" });
    expect(m.rows.get(RESEARCH)!.has("owner")).toBe(true);
  });
});

describe("契约面", () => {
  it("三个操作的 err 都是 ProjectReason 的成员；in/out 的 role 与 NonWorkshopMemberRole 同源", () => {
    for (const op of [C.operations.listNonWorkshopMembers, C.operations.addNonWorkshopMember, C.operations.removeNonWorkshopMember]) {
      for (const code of op.err) expect(C.ProjectReason.options).toContain(code);
      expect(op.path.startsWith("/projects/:projectId/collaborators")).toBe(true);
    }
    expect(C.operations.addNonWorkshopMember.in.shape.role).toBe(C.NonWorkshopMemberRole);
    expect(C.NonWorkshopMemberEntry.shape.role).toBe(C.NonWorkshopMemberRole);
    expect(C.NonWorkshopMemberRole.options).toEqual(["owner", "collaborator"]);
  });
});
