/**
 * B3-T3（issue #4497）—— `getProjectReasoning`：可见性与 `getProjectKnowledge` 同一份判定（项目成员含观察者），
 * 非成员 KG_NOT_VISIBLE；两个守卫读都要交出同一个决策。纯 application 层：identity 假仓储 + guard 过的假知识端口。
 */
import { describe, expect, it } from "vitest";
import { getProjectReasoning } from "../../src/application/knowledge-graph/read-project-reasoning";
import { KgReadError, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { KnowledgeReadPort, ProjectClaimEvidenceData, ProjectKnowledgeData } from "../../src/application/knowledge-graph/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-t3");
const PROJECT = "p-t3";
const DATA: ProjectKnowledgeData = {
  revision: 2, objects: [{ id: "o-de", scope: { kind: "project", id: PROJECT }, kind: "organization", name: "德国", aliases: [], createdBy: "human", claimCount: 2 }],
  edges: [], sharedFromPersonal: [],
  claims: [
    {
      id: "a", scope: { kind: "project", id: PROJECT }, kind: "fact", statement: "德国 9/29 上线", status: "accepted", triState: "confirmed",
      confidence: 1, createdBy: "human", reviewedBy: "u-fac", supersedesClaimId: null, derivedFromClaimId: null,
      aboutObjectIds: ["o-de"], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "b", scope: { kind: "project", id: PROJECT }, kind: "fact", statement: "德国 改到 10/1 上线", status: "accepted", triState: "confirmed",
      confidence: 1, createdBy: "human", reviewedBy: "u-fac", supersedesClaimId: null, derivedFromClaimId: null,
      aboutObjectIds: ["o-de"], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-02T00:00:00Z",
    },
    {
      id: "h", scope: { kind: "project", id: PROJECT }, kind: "hypothesis", statement: "业主愿为工期承诺付溢价", status: "proposed", triState: "pending",
      confidence: 0.6, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
      aboutObjectIds: [], supportingCount: 0, contradictingCount: 0, createdAt: "2026-09-03T00:00:00Z",
    },
  ],
};
const EVIDENCE: ProjectClaimEvidenceData = {
  a: [{ segmentId: "m1", stance: "supporting", sourceKind: "chat_message", sourceRef: "m1", excerpt: "9/29 上", locator: null, revoked: false }],
  b: [{ segmentId: "s1", stance: "supporting", sourceKind: "survey_response", sourceRef: "r1", evidenceId: "ev-b", excerpt: "改到 10/1", locator: null, revoked: false }],
};

function deps(members: ConstructorParameters<typeof FakeRoleViewRepository>[0], calls: string[] = []): KnowledgeReadDeps & { now: () => Date } {
  const knowledge = {
    projectKnowledge: async () => { calls.push("knowledge"); return guard({ kind: "project", id: PROJECT }, DATA); },
    projectClaimEvidence: async () => { calls.push("evidence"); return guard({ kind: "project", id: PROJECT }, EVIDENCE); },
  } as unknown as KnowledgeReadPort;
  return { repo: new FakeRoleViewRepository(members), ids: { next: () => "dec" } as never, chat: {} as never, knowledge, now: () => new Date("2026-09-27T12:00:00Z") };
}

describe("getProjectReasoning", () => {
  it.each([["facilitator"], ["member"], ["observer"]] as const)("项目成员（%s）读到三块推理结果与 computedAt", async (role) => {
    const out = await getProjectReasoning(deps({ u1: { orgRole: "consultant", projectRole: role, groupId: null } }), { userId: "u1", orgId: ORG, projectId: PROJECT });
    expect(out.computedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(out.conflicts).toEqual([expect.objectContaining({ claimIds: ["a", "b"], kind: "cross_source", evidenceIdsB: ["ev-b"] })]);
    expect(out.gaps).toEqual([expect.objectContaining({ claimId: "h", kind: "no_evidence" })]);
    expect(out.chains).toEqual([]);
  });

  it("组织成员但非项目成员 ⇒ KG_NOT_VISIBLE，且不读任何内容；不在组织里 ⇒ 同样 KG_NOT_VISIBLE", async () => {
    const calls: string[] = [];
    await expect(getProjectReasoning(deps({ u1: { orgRole: "consultant", projectRole: null } }, calls), { userId: "u1", orgId: ORG, projectId: PROJECT }))
      .rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    expect(calls).toEqual([]);
    await expect(getProjectReasoning(deps({}), { userId: "stranger", orgId: ORG, projectId: PROJECT }))
      .rejects.toBeInstanceOf(KgReadError);
  });
});
