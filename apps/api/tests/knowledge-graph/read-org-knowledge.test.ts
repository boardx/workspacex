/**
 * B2-S4（issue #4428）—— `getOrgKnowledge`：组织记忆对任何组织成员披露，外人 KG_NOT_VISIBLE；
 * `canPromoteToOrg` 只对 lead / admin。纯 application 层：identity 假仓储 + guard 过的假知识端口；判定走真实 `authorize`。
 */
import { describe, expect, it } from "vitest";
import { canPromoteToOrg, getOrgKnowledge } from "../../src/application/knowledge-graph/read-org-knowledge";
import { getProjectKnowledge } from "../../src/application/knowledge-graph/read-project-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { KnowledgeReadPort, OrgKnowledgeData } from "../../src/application/knowledge-graph/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-b2");
const PROJECT = "p-b2";
const DATA: OrgKnowledgeData = {
  revision: 1, objects: [], edges: [],
  claims: [{
    id: "g1", scope: { kind: "org", id: ORG }, kind: "decision", statement: "先做德国工商业", status: "accepted", triState: "confirmed",
    confidence: 1, createdBy: "human", reviewedBy: "u-lead", supersedesClaimId: null, derivedFromClaimId: "c1",
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
  }],
};

function deps(members: ConstructorParameters<typeof FakeRoleViewRepository>[0], ref = { kind: "project" as const, id: `org:${ORG}` }): KnowledgeReadDeps {
  const knowledge = {
    orgKnowledge: async () => guard(ref, DATA),
    projectKnowledge: async () => guard({ kind: "project", id: PROJECT }, { ...DATA, claims: [] }),
  } as unknown as KnowledgeReadPort;
  return { repo: new FakeRoleViewRepository(members), ids: { next: () => "dec" } as never, chat: {} as never, knowledge };
}

describe("getOrgKnowledge", () => {
  it.each([["admin"], ["lead"], ["consultant"], ["compliance"]] as const)("组织成员（%s）能读到组织记忆", async (role) => {
    const out = await getOrgKnowledge(deps({ u1: { orgRole: role, projectRole: null } }), { userId: "u1", orgId: ORG });
    expect(out.scope).toEqual({ kind: "org", id: ORG });
    expect(out.claims.map((c) => c.statement)).toEqual(["先做德国工商业"]);
  });

  it("不在组织里 ⇒ KG_NOT_VISIBLE", async () => {
    await expect(getOrgKnowledge(deps({}), { userId: "stranger", orgId: ORG })).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    await expect(getOrgKnowledge(deps({}), { userId: "stranger", orgId: ORG })).rejects.toBeInstanceOf(KgReadError);
  });

  it("读口交回的不是本组织的空间 ⇒ 拒绝，内容不出去（主人取自 guard ref，不信调用方）", async () => {
    await expect(getOrgKnowledge(deps({ u1: { orgRole: "admin", projectRole: null } }, { kind: "project", id: "org:other-org" }), { userId: "u1", orgId: ORG }))
      .rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
  });
});

describe("canPromoteToOrg", () => {
  it("只有 lead / admin；consultant / compliance / 非成员都不能", () => {
    expect(canPromoteToOrg({ orgRole: "lead", teamId: null })).toBe(true);
    expect(canPromoteToOrg({ orgRole: "admin", teamId: null })).toBe(true);
    expect(canPromoteToOrg({ orgRole: "consultant", teamId: null })).toBe(false);
    expect(canPromoteToOrg({ orgRole: "compliance", teamId: null })).toBe(false);
    expect(canPromoteToOrg(null)).toBe(false);
  });

  it("getProjectKnowledge 按同一判据带上 canPromoteToOrg：项目引导师但组织 consultant ⇒ false；组织 lead 的项目成员 ⇒ true", async () => {
    const fac = await getProjectKnowledge(deps({ u1: { orgRole: "consultant", projectRole: "facilitator", groupId: null } }), { userId: "u1", orgId: ORG, projectId: PROJECT });
    expect(fac.canPromoteToOrg).toBe(false);
    const lead = await getProjectKnowledge(deps({ u1: { orgRole: "lead", projectRole: "member", groupId: null } }), { userId: "u1", orgId: ORG, projectId: PROJECT });
    expect(lead.canPromoteToOrg).toBe(true);
  });
});
