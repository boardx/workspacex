/**
 * 项目中枢 B2-S1（#4425）—— 项目资源关联三个用例的**编排**断言，喂 in-memory 假仓储
 * （同 `accept-project-invite.test.ts` 的做法）。SQL 那一侧（四类 UNION、幂等 upsert、解挂）
 * 由 `project-resources-pg.test.ts` 对真实 PostgreSQL 断言。
 *
 * 钉住：成员 / 观察者能读；非成员 NO_PROJECT_ROLE；组织管理员无项目角色 ADMIN_NOT_SUPERUSER；
 * 判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE（不降级放行）；挂别人的（或不存在的）资源
 * ⇒ RESOURCE_NOT_FOUND 且**不写链接**；挂两次 ⇒ alreadyLinked；容器不存在 ⇒ NO_PROJECT_ROLE；
 * 列表按 linkedAt 倒序、四类计数含 0。
 */
import { describe, expect, it } from "vitest";
import { listProjectResources } from "../../src/application/project/list-project-resources";
import { linkProjectResource } from "../../src/application/project/link-project-resource";
import { unlinkProjectResource } from "../../src/application/project/unlink-project-resource";
import type {
  LinkResourceOutcome,
  ProjectLinkableResourceKind,
  ProjectResourcePort,
  ProjectResourceRow,
} from "../../src/application/project/project-resource-ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-b2s1");
const PROJECT = "p-b2s1";

type LinkKey = `${string}:${string}`;

class FakeResources implements ProjectResourcePort {
  /** 资源表：`kind:id` → 所有者。 */
  readonly owned = new Map<LinkKey, string>();
  /** 链接表：`kind:id` → projectId。 */
  readonly links = new Map<LinkKey, string>();
  readonly rows: ProjectResourceRow[] = [];
  constructor(private readonly projectExists = true) {}

  async listProjectResources(_o: OrgId, projectId: string): Promise<Guarded<readonly ProjectResourceRow[] | null>> {
    const ref = { kind: "project" as const, id: projectId };
    return guard(ref, this.projectExists ? this.rows : null);
  }
  async isOwnedResource(_o: OrgId, kind: ProjectLinkableResourceKind, id: string, owner: string): Promise<boolean> {
    return this.owned.get(`${kind}:${id}`) === owner;
  }
  async linkResource(input: { projectId: string; kind: ProjectLinkableResourceKind; resourceId: string }): Promise<LinkResourceOutcome> {
    if (!this.projectExists) return { kind: "project-not-found" };
    const key: LinkKey = `${input.kind}:${input.resourceId}`;
    if (this.links.get(key) === input.projectId) return { kind: "already-linked" };
    this.links.set(key, input.projectId);
    return { kind: "linked" };
  }
  async unlinkResource(_o: OrgId, projectId: string, kind: ProjectLinkableResourceKind, id: string): Promise<boolean> {
    const key: LinkKey = `${kind}:${id}`;
    if (this.links.get(key) !== projectId) return false;
    this.links.delete(key);
    return true;
  }
}

const identity = new FakeRoleViewRepository({
  member: { orgRole: "consultant", projectRole: "member" },
  observer: { orgRole: "consultant", projectRole: "observer" },
  outsider: { orgRole: "consultant", projectRole: null },
  admin: { orgRole: "admin", projectRole: null },
});

function deps(resources: ProjectResourcePort, repo: IdentityRepository = identity) {
  return { auth: { repo, ids: new FakeDecisionIds() }, resources };
}
const viewer = (userId: string) => ({ userId, orgId: ORG, projectId: PROJECT });

const row = (kind: ProjectResourceRow["kind"], id: string, linkedAt: string): ProjectResourceRow => ({
  kind, id, title: `t-${id}`, ownerUserId: "member", status: null, updatedAt: linkedAt, linkedAt,
});

describe("listProjectResources：成员门 + 四类聚合", () => {
  it("成员与观察者都能读；按 linkedAt 倒序；四类计数含 0", async () => {
    const res = new FakeResources();
    res.rows.push(
      row("survey", "s1", "2026-09-01T00:00:00.000Z"),
      row("interview", "i1", "2026-09-03T00:00:00.000Z"),
      row("survey", "s2", "2026-09-02T00:00:00.000Z"),
    );
    for (const u of ["member", "observer"]) {
      const out = await listProjectResources(deps(res), viewer(u));
      expect(out.items.map((x) => x.id)).toEqual(["i1", "s2", "s1"]);
      expect(out.counts).toEqual({ survey: 2, guided_research: 0, personal_transcription: 0, interview: 1 });
    }
  });

  it("非成员 ⇒ NO_PROJECT_ROLE；组织管理员无项目角色 ⇒ ADMIN_NOT_SUPERUSER（分层透传）", async () => {
    const res = new FakeResources();
    await expect(listProjectResources(deps(res), viewer("outsider"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listProjectResources(deps(res), viewer("admin"))).rejects.toMatchObject({ reasonCode: "ADMIN_NOT_SUPERUSER" });
  });

  it("容器不存在 ⇒ NO_PROJECT_ROLE，与「没有角色」不可分辨", async () => {
    await expect(listProjectResources(deps(new FakeResources(false)), viewer("member"))).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });

  it("判定服务不可用 ⇒ AUTH_SERVICE_UNAVAILABLE，不降级放行", async () => {
    const broken: IdentityRepository = Object.assign(Object.create(identity), {
      findOrgMembership: async () => { throw new Error("pg down"); },
    });
    await expect(listProjectResources(deps(new FakeResources(), broken), viewer("member"))).rejects.toMatchObject({
      reasonCode: "AUTH_SERVICE_UNAVAILABLE",
    });
  });
});

describe("linkProjectResource / unlinkProjectResource：成员 + 所有者两道门", () => {
  it("自己的资源 ⇒ 挂上；再挂一次 ⇒ alreadyLinked", async () => {
    const res = new FakeResources();
    res.owned.set("survey:s1", "member");
    const cmd = { ...viewer("member"), kind: "survey" as const, resourceId: "s1" };
    expect(await linkProjectResource(deps(res), cmd)).toEqual({ projectId: PROJECT, kind: "survey", resourceId: "s1", alreadyLinked: false });
    expect(await linkProjectResource(deps(res), cmd)).toMatchObject({ alreadyLinked: true });
    expect(res.links.get("survey:s1")).toBe(PROJECT);
  });

  it("别人的资源与不存在的资源同一个出口：RESOURCE_NOT_FOUND，且不写链接", async () => {
    const res = new FakeResources();
    res.owned.set("guided_research:g1", "observer");
    await expect(
      linkProjectResource(deps(res), { ...viewer("member"), kind: "guided_research", resourceId: "g1" }),
    ).rejects.toMatchObject({ reasonCode: "RESOURCE_NOT_FOUND" });
    await expect(
      linkProjectResource(deps(res), { ...viewer("member"), kind: "personal_transcription", resourceId: "nope" }),
    ).rejects.toMatchObject({ reasonCode: "RESOURCE_NOT_FOUND" });
    expect(res.links.size).toBe(0);
  });

  it("先判项目再判资源：非成员挂自己的资源也是 NO_PROJECT_ROLE（探不到资源存在性）", async () => {
    const res = new FakeResources();
    res.owned.set("survey:s1", "outsider");
    await expect(
      linkProjectResource(deps(res), { ...viewer("outsider"), kind: "survey", resourceId: "s1" }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("容器不存在 ⇒ NO_PROJECT_ROLE", async () => {
    const res = new FakeResources(false);
    res.owned.set("survey:s1", "member");
    await expect(
      linkProjectResource(deps(res), { ...viewer("member"), kind: "survey", resourceId: "s1" }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("解挂：自己的、挂着的 ⇒ removed=true；没挂着 ⇒ removed=false；别人的 ⇒ RESOURCE_NOT_FOUND", async () => {
    const res = new FakeResources();
    res.owned.set("survey:s1", "member");
    res.owned.set("survey:s2", "observer");
    res.links.set("survey:s1", PROJECT);
    res.links.set("survey:s2", PROJECT);
    const mine = { ...viewer("member"), kind: "survey" as const, resourceId: "s1" };
    expect(await unlinkProjectResource(deps(res), mine)).toEqual({ removed: true });
    expect(await unlinkProjectResource(deps(res), mine)).toEqual({ removed: false });
    await expect(
      unlinkProjectResource(deps(res), { ...viewer("member"), kind: "survey", resourceId: "s2" }),
    ).rejects.toMatchObject({ reasonCode: "RESOURCE_NOT_FOUND" });
    expect(res.links.get("survey:s2")).toBe(PROJECT);
  });
});
