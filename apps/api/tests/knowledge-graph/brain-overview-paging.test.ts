/**
 * UC-KG-13 的上限作用在**可见性判定之后**（评审 N6）：候选按最近活动倒序分批取，
 * 看不见的会话（被移出项目、判定为不存在……）不能把看得见的挤出这一页。
 *
 * 纯应用层：读口与身份仓库用最小替身，判定本身（visibleThread → resolveVisibility → authorize）是真代码。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { getBrainOverview } from "../../src/application/knowledge-graph/read-personal-knowledge";
import type { KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-paging");
const ME = "u-me";
const LIMIT = KG.KG_BRAIN_THREADS_LIMIT;
/** 120 个候选：最近的 60 个都看不见，后 60 个看得见。 */
const CANDIDATES = Array.from({ length: 120 }, (_, i) => ({ id: `t-${String(i).padStart(3, "0")}`, visible: i >= 60 }));

function deps(calls: { limit: number; offset: number }[]): KnowledgeReadDeps {
  const byId = new Map(CANDIDATES.map((c) => [c.id, c]));
  return {
    ids: { next: () => "dec-1" },
    repo: {
      findOrgMembership: async () => ({ orgRole: "consultant", teamId: null }),
      findProjectMembership: async () => null,
      findBindings: async () => new Map(),
    } as never,
    chat: {
      findThreadFacts: async (_o: unknown, threadId: string) => byId.get(threadId)?.visible
        ? { threadId, projectId: null, groupId: null, visibilityScope: "private", createdBy: ME, archived: false }
        : null,
      findThreadPresentation: async (_o: unknown, threadId: string) => ({ phase: "onsite", lastActivityAt: "2026-09-24T00:00:00.000Z", version: 1, title: threadId }),
    } as never,
    knowledge: {
      threadKnowledgeSummaries: async (_o: unknown, _u: string, limit: number, offset: number) => {
        calls.push({ limit, offset });
        return CANDIDATES.slice(offset, offset + limit).map((c) => ({
          threadId: c.id,
          counts: guard({ kind: "project", id: `personal:${c.id}` }, { threadId: c.id, projectId: null, pending: 1, confirmed: 0, conflict: 0, objects: 0 }),
        }));
      },
      personalClaimOrigins: async () => [],
    } as never,
  };
}

describe("UC-KG-13 上限在可见性判定之后", () => {
  it("前 60 个看不见 ⇒ 接着往后取，凑满上限，全是看得见的，顺序不变", async () => {
    const calls: { limit: number; offset: number }[] = [];
    const out = await getBrainOverview(deps(calls), { userId: ME, orgId: ORG });
    expect(out.threads).toHaveLength(LIMIT);
    expect(out.threads.map((t) => t.threadId)).toEqual(CANDIDATES.filter((c) => c.visible).slice(0, LIMIT).map((c) => c.id));
    expect(calls).toEqual([{ limit: LIMIT, offset: 0 }, { limit: LIMIT, offset: LIMIT }, { limit: LIMIT, offset: 2 * LIMIT }]);
  });

  it("候选取尽就停，不多打一次", async () => {
    const calls: { limit: number; offset: number }[] = [];
    const d = deps(calls);
    const all = d.knowledge.threadKnowledgeSummaries.bind(d.knowledge);
    (d.knowledge as { threadKnowledgeSummaries: typeof all }).threadKnowledgeSummaries = async (o, u, limit, offset) =>
      (await all(o, u, limit, offset)).filter((c) => Number(c.threadId.slice(2)) < 70);
    const out = await getBrainOverview(d, { userId: ME, orgId: ORG });
    expect(out.threads.map((t) => t.threadId)).toEqual(CANDIDATES.slice(60, 70).map((c) => c.id));
    expect(calls).toHaveLength(2);
  });
});
