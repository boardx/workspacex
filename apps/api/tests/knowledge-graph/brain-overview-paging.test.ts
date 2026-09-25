/**
 * UC-KG-13 的上限作用在**可见性判定之后**（评审 N6）：候选按最近活动倒序分批取，
 * 看不见的会话（被移出项目、判定为不存在……）不能把看得见的挤出这一页。
 *
 * 纯应用层：读口与身份仓库用最小替身，判定本身（visibleThread → resolveVisibility → authorize）是真代码。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { BRAIN_MAX_CANDIDATE_BATCHES, decidePersonalSpace, getBrainOverview } from "../../src/application/knowledge-graph/read-personal-knowledge";
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

  it("读口分页失效（永远交回同一批、全都看不见）⇒ 扫到上限就停，不会无限打下去（评审 N-b / N-c）", async () => {
    const calls: { limit: number; offset: number }[] = [];
    const d = deps(calls);
    const all = d.knowledge.threadKnowledgeSummaries.bind(d.knowledge);
    (d.knowledge as { threadKnowledgeSummaries: typeof all }).threadKnowledgeSummaries = async (o, u, limit, _offset) =>
      all(o, u, limit, 0);
    const out = await getBrainOverview(d, { userId: ME, orgId: ORG });
    expect(out.threads).toEqual([]);
    expect(calls).toHaveLength(BRAIN_MAX_CANDIDATE_BATCHES);
  });
});

describe("个人空间判定：主人取自读口交回的 guard ref（评审 N-a）", () => {
  const viewer = { userId: ME, orgId: ORG };
  it("读口交回本人的空间 ⇒ 放行", async () => {
    const d = await decidePersonalSpace(deps([]), viewer, guard({ kind: "project", id: `personal:${ME}` }, {}));
    expect(d.allowed).toBe(true);
  });
  it("读口（缺陷）交回别人的空间 ⇒ 拒绝，即使组织层通过", async () => {
    const d = await decidePersonalSpace(deps([]), viewer, guard({ kind: "project", id: "personal:u-someone-else" }, {}));
    expect(d.orgLayer.passed).toBe(true);
    expect(d.allowed).toBe(false);
  });
  it("交回的不是个人空间 ref ⇒ 拒绝", async () => {
    const d = await decidePersonalSpace(deps([]), viewer, guard({ kind: "project", id: ME }, {}));
    expect(d.allowed).toBe(false);
  });
});
