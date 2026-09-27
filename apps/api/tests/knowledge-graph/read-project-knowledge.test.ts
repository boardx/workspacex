/**
 * 项目中枢 R8 —— `getProjectKnowledge`：项目记忆只对项目成员披露（含观察者），非成员 KG_NOT_VISIBLE。
 * 纯 application 层：identity 假仓储 + guard 过的假知识端口；判定走真实 `authorize`。
 */
import { describe, expect, it } from "vitest";
import { getProjectKnowledge } from "../../src/application/knowledge-graph/read-project-knowledge";
import { KgReadError, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { KnowledgeReadPort, ProjectKnowledgeData } from "../../src/application/knowledge-graph/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-r8");
const PROJECT = "p-r8";
const DATA: ProjectKnowledgeData = {
  revision: 2, objects: [], edges: [],
  claims: [{
    id: "c1", scope: { kind: "project", id: PROJECT }, kind: "decision", statement: "先做德国工商业", status: "accepted", triState: "confirmed",
    confidence: 1, createdBy: "human", reviewedBy: "u-fac", supersedesClaimId: null, derivedFromClaimId: "c0",
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
  }],
};

function deps(members: ConstructorParameters<typeof FakeRoleViewRepository>[0]): KnowledgeReadDeps {
  const knowledge = {
    projectKnowledge: async () => guard({ kind: "project", id: PROJECT }, DATA),
  } as unknown as KnowledgeReadPort;
  return { repo: new FakeRoleViewRepository(members), ids: { next: () => "dec" } as never, chat: {} as never, knowledge };
}

describe("getProjectKnowledge", () => {
  it.each([["facilitator"], ["member"], ["observer"]] as const)("项目成员（%s）能读到项目记忆", async (role) => {
    const out = await getProjectKnowledge(deps({ u1: { orgRole: "consultant", projectRole: role, groupId: null } }), { userId: "u1", orgId: ORG, projectId: PROJECT });
    expect(out.scope).toEqual({ kind: "project", id: PROJECT });
    expect(out.claims.map((c) => c.statement)).toEqual(["先做德国工商业"]);
  });

  it("组织成员但非项目成员 ⇒ KG_NOT_VISIBLE；不在组织里 ⇒ 同样 KG_NOT_VISIBLE", async () => {
    await expect(getProjectKnowledge(deps({ u1: { orgRole: "consultant", projectRole: null } }), { userId: "u1", orgId: ORG, projectId: PROJECT }))
      .rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    await expect(getProjectKnowledge(deps({}), { userId: "stranger", orgId: ORG, projectId: PROJECT }))
      .rejects.toBeInstanceOf(KgReadError);
  });
});
