/**
 * 项目中枢 R9 —— `getClaimSources` 对项目记忆（L2）结论：项目成员能回链到来源会话；
 * 非成员与不存在同一个出口；证据会话被移出可见范围后不再从 L2 漏出来。
 * 纯 application 层：identity 假仓储 + 假知识端口 + 假 chat 事实；判定（visibleThread → resolveVisibility → authorize）是真代码。
 */
import { describe, expect, it } from "vitest";
import { getClaimSources, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { ClaimSourcesData, KnowledgeThreadRef } from "../../src/application/knowledge-graph/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-r9");
const PROJECT = "p-r9";
const CLAIM = "c-proj-1";
const SOURCES: ClaimSourcesData = {
  claim: {
    id: CLAIM, scope: { kind: "project", id: PROJECT }, kind: "hypothesis", statement: "业主愿为工期承诺付溢价", status: "accepted", triState: "confirmed",
    confidence: 1, createdBy: "human", reviewedBy: "u-fac", supersedesClaimId: null, derivedFromClaimId: "c-thr-1",
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
  },
  evidence: [{ segmentId: "m1", stance: "supporting", sourceKind: "chat_message", sourceRef: "m1", excerpt: "客户说愿意多付", locator: null, revoked: false }],
  provenance: [],
};

function deps(members: ConstructorParameters<typeof FakeRoleViewRepository>[0], threads: Record<string, { projectId: string | null; scope: string }>, calls: (readonly string[] | undefined)[] = []): KnowledgeReadDeps {
  return {
    repo: new FakeRoleViewRepository(members),
    ids: { next: () => "dec" } as never,
    chat: {
      findThreadFacts: async (_o: unknown, threadId: string) => {
        const t = threads[threadId];
        return t ? { threadId, projectId: t.projectId, groupId: null, visibilityScope: t.scope, createdBy: "u-creator", archived: false } : null;
      },
    } as never,
    knowledge: {
      claimRoute: async () => ({ scopeKind: "project", scopeId: PROJECT }),
      claimEvidenceThreads: async () => Object.keys(threads),
      claimSources: async (_o: unknown, _u: string, _c: string, ref: KnowledgeThreadRef, only?: readonly string[]) => {
        calls.push(only);
        return guard({ kind: "project", id: ref.projectId ?? "" }, SOURCES);
      },
    } as never,
  };
}

const PLENARY = { "t-1": { projectId: PROJECT, scope: "plenary" } };

describe("R9 getClaimSources · 项目记忆结论", () => {
  it.each([["facilitator"], ["member"], ["observer"]] as const)("项目成员（%s）读到来源，证据范围只含看得见的会话", async (role) => {
    const calls: (readonly string[] | undefined)[] = [];
    const out = await getClaimSources(deps({ "u-x": { orgRole: "consultant", projectRole: role, groupId: null } }, PLENARY, calls), { userId: "u-x", orgId: ORG, claimId: CLAIM });
    expect(out.claim.statement).toBe("业主愿为工期承诺付溢价");
    expect(out.evidence.map((e) => e.sourceRef)).toEqual(["m1"]);
    expect(calls).toEqual([["t-1"]]);
  });

  it("组织成员但非项目成员 ⇒ KG_CLAIM_NOT_FOUND（与不存在同一出口），且不去读来源", async () => {
    const calls: (readonly string[] | undefined)[] = [];
    await expect(getClaimSources(deps({ "u-x": { orgRole: "consultant", projectRole: null } }, PLENARY, calls), { userId: "u-x", orgId: ORG, claimId: CLAIM }))
      .rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("证据会话对这个成员不可见（member-private 且不是创建者）⇒ 一条可见会话都没有 ⇒ KG_CLAIM_NOT_FOUND", async () => {
    await expect(getClaimSources(deps({ "u-x": { orgRole: "consultant", projectRole: "member", groupId: null } }, { "t-1": { projectId: PROJECT, scope: "member-private" } }), { userId: "u-x", orgId: ORG, claimId: CLAIM }))
      .rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
  });
});
