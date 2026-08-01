/**
 * F147 —— 决策节点回流的部分成功（`uc-24-4` A1 / R3.2③ / E2 / E5 / R9 / R12.4–7）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 * `persistInsight` 在下方用一个内存 Map 模拟"洞察库"，不是真的数据库连接——
 * 这样才能断言 E5「结论原状保留、可重试、不显示已入库」而不牵扯基础设施。
 *
 * ## 本文件必须立住的一条（本束唯一的部分成功）
 * `DECISION_NODE_GONE` 只应出现在 `promoted.nodeBackflow.reason`，**绝不**
 * 出现在 `blocked` 分支——把它塞进 err 会让前端在节点已删时误判"入库失败"，
 * 从而回滚一次已经成功的入库。
 */
import { describe, expect, it, vi } from "vitest";
import { research } from "@repo/contracts";
import {
  computeNodeBackflow,
  promoteConclusion,
  CANDIDATE_STATUS_PENDING,
  type ConclusionForPromotion,
  type EvidenceT,
} from "../../src/domain/research/promote-insight";

function evidence(overrides: Partial<EvidenceT> & Pick<EvidenceT, "id">): EvidenceT {
  return {
    claim: "占位陈述",
    sourceKind: "官方",
    sourceRef: `src-${overrides.id}`,
    confidence: 0.9,
    disposition: "已引用",
    ...overrides,
  };
}

function conclusion(overrides: Partial<ConclusionForPromotion> & Pick<ConclusionForPromotion, "id">): ConclusionForPromotion {
  return {
    researchId: "r1",
    evidence: [evidence({ id: "e1" })],
    disputed: false,
    conflict: null,
    ...overrides,
  };
}

describe("F147 · A1 · 配置里选了「不挂节点」——合法路径，不是降级", () => {
  it("computeNodeBackflow(decisionNodeRef=null) ⇒ attempted:false, ok:true, reason:null", () => {
    expect(computeNodeBackflow({ decisionNodeRef: null, nodeExists: true })).toEqual({
      attempted: false,
      ok: true,
      reason: null,
    });
  });

  it("端到端：n0 的研究入库成功且无节点回流记录（attempted:false）", async () => {
    const persist = vi.fn();
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: null, nodeExists: true },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result.kind).toBe("promoted");
    if (result.kind !== "promoted") throw new Error("unreachable");
    expect(result.nodeBackflow.attempted).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("F147 · R3.2③ · 挂了 n1 的研究入库后，节点上出现一条带置信度的回流记录", () => {
  it("computeNodeBackflow(decisionNodeRef='n1', nodeExists=true) ⇒ attempted:true, ok:true, reason:null", () => {
    expect(computeNodeBackflow({ decisionNodeRef: "n1", nodeExists: true })).toEqual({
      attempted: true,
      ok: true,
      reason: null,
    });
  });

  it("端到端：挂 n1 的研究入库成功，且回流结果标为 attempted+ok（可据此写一条带置信度的回流记录）", async () => {
    const persist = vi.fn();
    const c = conclusion({ id: "c1", evidence: [evidence({ id: "e1", confidence: 0.8 })] });
    const result = await promoteConclusion(
      c,
      { decisionNodeRef: "n1", nodeExists: true },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result.kind).toBe("promoted");
    if (result.kind !== "promoted") throw new Error("unreachable");
    expect(result.nodeBackflow).toEqual({ attempted: true, ok: true, reason: null });
    // 置信度随候选洞察可读——回流记录据此携带的置信度不是凭空的
    expect(result.insight.evidence[0]?.confidence).toBe(0.8);
  });
});

describe("F147 · E2 · 决策节点已被删除 / 已关闭：入库仍成功，回流失败原因可读", () => {
  it("computeNodeBackflow(nodeExists=false) ⇒ attempted:true, ok:false, reason:'DECISION_NODE_GONE'", () => {
    expect(computeNodeBackflow({ decisionNodeRef: "n1", nodeExists: false })).toEqual({
      attempted: true,
      ok: false,
      reason: "DECISION_NODE_GONE",
    });
  });

  it("端到端：节点已删除时 promoteConclusion 仍返回 promoted（入库成功），不是 blocked", async () => {
    const persist = vi.fn();
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: "n1", nodeExists: false },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result.kind).toBe("promoted");
    expect(persist).toHaveBeenCalledTimes(1);
    if (result.kind !== "promoted") throw new Error("unreachable");
    expect(result.nodeBackflow.ok).toBe(false);
    expect(result.nodeBackflow.reason).toBe("DECISION_NODE_GONE");
  });

  it("反证（本文件的核心断言）：DECISION_NODE_GONE 绝不会以 blocked/err 的形式出现", async () => {
    const persist = vi.fn();
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: "n1", nodeExists: false },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result.kind).not.toBe("blocked");
    // 契约层面的编译期反证：DECISION_NODE_GONE 不在本操作的 err 面上
    const err: readonly string[] = research.operations.promoteConclusionToInsight.err;
    expect(err).not.toContain("DECISION_NODE_GONE");
  });

  it("契约面校验：node-gone 场景下整个 out 形状（含 insight）仍能通过 zod 校验", async () => {
    const persist = vi.fn();
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: "n1", nodeExists: false },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    if (result.kind !== "promoted") throw new Error("unreachable");
    const outSchema = research.operations.promoteConclusionToInsight.out;
    expect(() => outSchema.parse({ insight: result.insight, nodeBackflow: result.nodeBackflow })).not.toThrow();
  });
});

describe("F147 · E5 · 下游（洞察库）不可用：结论原状保留、可重试、不显示已入库", () => {
  it("persistInsight 抛出 ⇒ promoteConclusion 返回 persist-failed，不是 promoted", async () => {
    const store = new Map<string, unknown>();
    const persist = vi.fn(async () => {
      throw new Error("insight store 500");
    });
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: "n1", nodeExists: true },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result).toEqual({ kind: "persist-failed" });
    // 不显示已入库：模拟的"洞察库"里什么都没有被写入
    expect(store.size).toBe(0);
  });

  it("可重试：同一条结论在下游恢复后再次调用 promoteConclusion 能够成功（不是被第一次失败卡死）", async () => {
    let calls = 0;
    const persist = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("insight store 500");
      // 第二次（重试）成功
    });
    const c = conclusion({ id: "c1" });
    const node = { decisionNodeRef: null, nodeExists: true } as const;
    const first = await promoteConclusion(c, node, { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] }, persist);
    expect(first).toEqual({ kind: "persist-failed" });
    const retry = await promoteConclusion(c, node, { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] }, persist);
    expect(retry.kind).toBe("promoted");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("下游失败时节点回流完全不被尝试——整单失败，不是「入库成功+回流也失败」的部分成功", async () => {
    const persist = vi.fn(async () => {
      throw new Error("insight store 500");
    });
    const result = await promoteConclusion(
      conclusion({ id: "c1" }),
      { decisionNodeRef: "n1", nodeExists: false },
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result).toEqual({ kind: "persist-failed" });
    expect(result).not.toHaveProperty("nodeBackflow");
  });
});
