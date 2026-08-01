/**
 * F126 —— UC-00.3 R5 的 audit 豁口：`purpose:"audit"` 是**放行 + 留痕 + 对项目负责人可见**，
 * 不是 403，且不区分管理员是否持有该项目的项目角色。
 *
 * 🔴 断言方向已经被 O-04 反转过一次（见 issue #248 与
 * `apps/api/tests/kernel/admin-boundary-deny.test.ts` 文件头引用的同一条历史）：
 * 早期稿本写 `expect(403)`，而 `decideContentRead`（phase-00 F03）的真实实现里
 * audit 分支本来就是 `{ kind: "allow", auditTrailRequired: true }`。本文件按**正确方向**
 * 断言——写反方向的测试会在一个正确实现上产生 403，从而被这里的绿灯挡住。
 *
 * 覆盖 R5 的三条：
 *   V4：admin + 无项目角色 + purpose:audit → 200，且不区分有没有项目角色。
 *   V5：资源标为 team-only 时，即使 purpose:audit，不在该团队的 admin 仍被拒
 *       （audit 只豁免项目层，不豁免组织层——design-coherence.md:412-415）。
 *   「对项目负责人可见」：写入的 provenance 事件可被组织 `lead`（项目负责人）
 *       通过唯一的审计读取面 `queryProvenance` 检索到。
 */
import { describe, expect, it } from "vitest";
import { readContent } from "../../src/application/identity/read-content";
import { queryProvenance } from "../../src/application/provenance/query-provenance";
import { decideContentRead } from "../../src/domain/identity/admin-boundary";
import { FakeDecisionIds, FakeProvenanceWriter } from "../support/role-view-fakes";
import { FakeBoundaryRepository, FakeContentRepository } from "../support/content-fakes";
import type { ProvenancePage, ProvenanceQuery, ProvenanceReader } from "../../src/application/provenance/ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("f126-audit-org");
const PROJECT = "f126-audit-proj";
const ITEM = "f126-audit-item";
const ADMIN = "u-f126-admin"; // 组织角色 admin，本项目**没有**项目角色
const LEAD = "u-f126-audit-lead"; // 项目负责人：组织角色 lead

/** `queryProvenance` 唯一需要的读口——内存版，按 targetId 过滤即可覆盖本文件的断言。 */
class FakeProvenanceReader implements ProvenanceReader {
  constructor(private readonly rows: ProvenancePage["events"]) {}
  async query(_orgId: unknown, filter: Omit<ProvenanceQuery, "orgId">): Promise<ProvenancePage> {
    const events = this.rows.filter((e) => {
      if (filter.targetId !== undefined && e.target.id !== filter.targetId) return false;
      if (filter.targetKind !== undefined && e.target.kind !== filter.targetKind) return false;
      return true;
    });
    return { events, nextCursor: null };
  }
}

describe('F126 V4：purpose:"audit" 是放行 + 留痕，不是 403', () => {
  it("admin 无项目角色 + purpose:audit → 200，且拿到内容与非空 provenanceEventId", async () => {
    const content = new FakeContentRepository();
    content.seed(ITEM, {
      layer: "project",
      status: "published",
      ownerUserId: "u-f126-someone-else",
      body: "the workshop's shared notes",
    });
    const identity = new FakeBoundaryRepository({
      [ADMIN]: { orgRole: "admin", projectRole: null },
    });
    const provenance = new FakeProvenanceWriter();

    const result = await readContent(
      { repo: identity, content, provenance, ids: new FakeDecisionIds() },
      { userId: ADMIN, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "audit" },
    );

    // 这是本文件存在的理由：不是 403，是 200 + 内容 + 留痕。
    expect(result.body).toBe("the workshop's shared notes");
    expect(result.provenanceEventId).not.toBeNull();

    // 不区分有没有项目角色：同一个 admin，这次带上一个项目角色，audit 读法完全一样通过。
    const identityWithRole = new FakeBoundaryRepository({
      [ADMIN]: { orgRole: "admin", projectRole: "member" },
    });
    const provenance2 = new FakeProvenanceWriter();
    const result2 = await readContent(
      { repo: identityWithRole, content, provenance: provenance2, ids: new FakeDecisionIds() },
      { userId: ADMIN, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "audit" },
    );
    expect(result2.body).toBe("the workshop's shared notes");
    expect(result2.provenanceEventId).not.toBeNull();
  });

  it("留痕先于内容返回：审计写入失败时，本次读取整体失败（不产生无记录的访问）", async () => {
    const content = new FakeContentRepository();
    content.seed(ITEM, {
      layer: "project", status: "published", ownerUserId: "u-someone", body: "secret",
    });
    const identity = new FakeBoundaryRepository({ [ADMIN]: { orgRole: "admin", projectRole: null } });
    const failingProvenance = {
      async append(): Promise<string> {
        throw new Error("audit sink unavailable");
      },
      async appendWithin(): Promise<string> {
        throw new Error("audit sink unavailable");
      },
    };

    await expect(
      readContent(
        { repo: identity, content, provenance: failingProvenance, ids: new FakeDecisionIds() },
        { userId: ADMIN, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "audit" },
      ),
    ).rejects.toThrow("audit sink unavailable");
  });
});

describe("F126 V5：audit 只豁免项目层，不豁免组织层——team-only 资源仍被拒", () => {
  it("资源标为仅 platform 团队，admin（不在该团队）带 purpose:audit 仍被拒", async () => {
    const content = new FakeContentRepository();
    content.seed(ITEM, {
      layer: "project", status: "published", ownerUserId: "u-someone", body: "team-only notes",
    });
    const identity = new FakeBoundaryRepository({
      [ADMIN]: { orgRole: "admin", projectRole: null, teamId: "team-energy" },
    });
    identity.bindTeamOnly({ kind: "artifact", id: ITEM }, "team-platform");
    const provenance = new FakeProvenanceWriter();

    await expect(
      readContent(
        { repo: identity, content, provenance, ids: new FakeDecisionIds() },
        { userId: ADMIN, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "audit" },
      ),
    ).rejects.toMatchObject({ reasonCode: "ORG_SCOPE_DENIED" });

    // 被拒，且没有内容泄露，也没有写下一条「放行」的审计——拒绝本身不冒充一次许可的访问。
    expect(provenance.appended).toHaveLength(0);
  });

  it("同一份资源，从 platform 团队内部读（同样 purpose:audit）就放行——反证不是「admin 恒被拒」", async () => {
    const identity = new FakeBoundaryRepository({
      [ADMIN]: { orgRole: "admin", projectRole: null, teamId: "team-platform" },
    });
    identity.bindTeamOnly({ kind: "artifact", id: ITEM }, "team-platform");

    const outcome = decideContentRead({
      item: { layer: "project", status: "published", ownerUserId: "u-someone" },
      requesterId: ADMIN,
      orgRole: "admin",
      purpose: "audit",
      baseDecision: {
        decisionId: "d-1",
        allowed: false,
        reasonCode: "ADMIN_NOT_SUPERUSER",
        orgLayer: { role: "admin", teamId: "team-platform", passed: true },
        projectLayer: null,
        scopeLayer: { scope: "team-only", passed: true },
      },
    });
    expect(outcome).toEqual({ kind: "allow", auditTrailRequired: true });
  });
});

describe("F126：admin 的 audit 读对项目负责人（组织角色 lead）可见", () => {
  it("写下的 provenance 事件可被 lead 通过 queryProvenance 按 targetId=projectId 检索到", async () => {
    const identity = new FakeBoundaryRepository({
      [LEAD]: { orgRole: "lead", projectRole: null },
    });
    const events: ProvenancePage["events"] = [
      {
        id: "ev-audit-1",
        orgId: ORG,
        type: "admin-project-access",
        actorId: ADMIN,
        target: { kind: "project", id: PROJECT },
        detail: { itemId: ITEM, purpose: "audit" },
        createdAt: new Date().toISOString(),
      } as unknown as ProvenancePage["events"][number],
    ];
    const reader = new FakeProvenanceReader(events);

    const page = await queryProvenance(
      { repo: identity, reader },
      { requesterId: LEAD, orgId: ORG, filter: { targetKind: "project", targetId: PROJECT } },
    );

    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.type).toBe("admin-project-access");
    expect(page.events[0]!.actorId).toBe(ADMIN);
  });

  it("一个既非 lead/admin/compliance、也不是查自己历史的人，读不到这条审计", async () => {
    const identity = new FakeBoundaryRepository({
      "u-f126-bystander": { orgRole: "consultant", projectRole: "member" },
    });
    const reader = new FakeProvenanceReader([]);

    await expect(
      queryProvenance(
        { repo: identity, reader },
        { requesterId: "u-f126-bystander", orgId: ORG, filter: { targetKind: "project", targetId: PROJECT } },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ROLE_INSUFFICIENT" });
  });
});
