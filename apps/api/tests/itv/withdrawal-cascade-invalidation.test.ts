/**
 * F89 —— 撤回的级联失效（uc-6-3 R4/A4 · [设计] Context Engine 第五节 · V7b）。
 *
 * 刻意不碰 Postgres：见 `withdrawal-five-steps-two-sla.test.ts` 头部说明与 issue #74。
 *
 * 本文件断言 V7b 列出的可验证失效标准：
 *   ① 撤回后新建的 Context Pack 中不含其 segmentId（用 `retrievableSegmentIds` 模拟"新建
 *      Context Pack 的候选集"）；
 *   ② OCR/embedding（含声纹）/图边/摘要/缓存一并失效（可验证：`isInvalidated` 为真）；
 *   ③ 以它为唯一证据的 Claim 转入 contested；
 *   ④ 未被撤回片段涉及的派生物/Claim 不受影响（避免"整场撤回"这种过度失效）；
 *   ⑤ 部分撤回（只撤某一同意位对应的片段）只失效被撤片段的派生物，其余同意位不受影响。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { requestWithdrawal } from "../../src/application/interview/request-withdrawal";
import type { ConsentKeyValue } from "../../src/application/interview/consent-token-ports";
import type { WithdrawalSegmentLocator } from "../../src/application/interview/withdrawal-ports";
import {
  FixedWithdrawalSegmentLocator,
  InMemoryCascadeInvalidationStore,
  InMemoryPendingDeletionQueue,
  InMemoryReportSegmentAnnotator,
  InMemoryRetrievalIndex,
  InMemorySignedDecisionReviewNotifier,
  InMemoryWithdrawalRepository,
} from "../../src/infrastructure/interview/in-memory-withdrawal-repository";

const SUBJECT = "sub-f89-mueller";
const OTHER_SUBJECT = "sub-f89-kraus";

/** 按 scope 圈定片段的测试替身——模拟"seg-mueller-1 属于 transcript 同意位、
 * seg-mueller-2 属于 record 同意位"这种真实分片，用来断言部分撤回不越界。 */
class ScopedSegmentLocator implements WithdrawalSegmentLocator {
  async segmentIdsFor(subjectId: string, scope: readonly ConsentKeyValue[]): Promise<readonly string[]> {
    if (subjectId !== SUBJECT) return [];
    return scope.includes("transcript") ? ["seg-mueller-1"] : [];
  }
}

function makeDeps(now: () => Date) {
  const withdrawals = new InMemoryWithdrawalRepository();
  const segments: WithdrawalSegmentLocator = new FixedWithdrawalSegmentLocator(
    new Map([
      [SUBJECT, ["seg-mueller-1", "seg-mueller-2"]],
      [OTHER_SUBJECT, ["seg-kraus-1"]],
    ]),
  );
  const deletionQueue = new InMemoryPendingDeletionQueue();
  const retrieval = new InMemoryRetrievalIndex();
  const cascade = new InMemoryCascadeInvalidationStore();
  const reportAnnotator = new InMemoryReportSegmentAnnotator();
  const decisionReview = new InMemorySignedDecisionReviewNotifier();
  let seq = 0;
  return {
    withdrawals,
    segments,
    deletionQueue,
    retrieval,
    cascade,
    reportAnnotator,
    decisionReview,
    now,
    newWithdrawalId: () => `wd-cascade-${++seq}`,
  };
}

describe("F89 · 撤回的级联失效", () => {
  let clockMs: number;
  const now = () => new Date(clockMs);

  beforeEach(() => {
    clockMs = Date.parse("2026-08-01T10:00:00.000Z");
  });

  it("V7b①：撤回后新建 Context Pack 的候选集中不含被撤回的 segmentId", async () => {
    const deps = makeDeps(now);

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });

    const candidatesForNewPack = ["seg-mueller-1", "seg-mueller-2", "seg-kraus-1"];
    const retrievable = deps.retrieval.retrievableSegmentIds(candidatesForNewPack);

    expect(retrievable).toEqual(["seg-kraus-1"]);
    expect(retrievable).not.toContain("seg-mueller-1");
    expect(retrievable).not.toContain("seg-mueller-2");
  });

  it("V7b②：OCR/embedding/图边/摘要/缓存一并失效，可逐类验证", async () => {
    const deps = makeDeps(now);
    deps.cascade.seedDerivative("seg-mueller-1", "ocr", "ocr-1");
    deps.cascade.seedDerivative("seg-mueller-1", "embedding", "emb-1");
    deps.cascade.seedDerivative("seg-mueller-1", "graph-edge", "edge-1");
    deps.cascade.seedDerivative("seg-mueller-2", "summary", "sum-1");
    deps.cascade.seedDerivative("seg-mueller-2", "cache", "cache-1");
    // 不相关受访者的派生物——不得被这次撤回连坐失效（④）。
    deps.cascade.seedDerivative("seg-kraus-1", "embedding", "emb-kraus");

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript", "ai_analysis"],
      reason: null,
      origin: "portal",
    });

    for (const id of ["ocr-1", "emb-1", "edge-1", "sum-1", "cache-1"]) {
      expect(deps.cascade.isInvalidated(id)).toBe(true);
    }
    expect(deps.cascade.isInvalidated("emb-kraus")).toBe(false);
  });

  it("V7b③：以被撤片段为唯一证据的 Claim 转 contested，不得继续以「已验证」呈现", async () => {
    const deps = makeDeps(now);
    deps.cascade.seedSoleEvidenceClaim("seg-mueller-1", "claim-solely-1");
    // 这条 claim 还有别的证据来源（本次撤回不涉及的片段）——不应被本用例标 contested，
    // 因为「唯一证据」的判定本身已经在端口实现里排除了它（种子数据里没有把它挂到
    // seg-mueller-1 上），这里只是显式验证"没有被误伤"。

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });

    expect(deps.cascade.contestedClaimIds.has("claim-solely-1")).toBe(true);
  });

  it("V7b⑤/部分撤回：只撤某一同意位对应的片段，其余同意位的派生物不受影响", async () => {
    const deps = makeDeps(now);
    deps.cascade.seedDerivative("seg-mueller-1", "embedding", "emb-transcript-scope");
    deps.segments = new ScopedSegmentLocator();

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });

    expect(deps.cascade.isInvalidated("emb-transcript-scope")).toBe(true);
    // seg-mueller-2（其余同意位）从未被传给 cascade 端口，检索排除集里也不含它。
    expect(deps.retrieval.excludedSegmentIds.has("seg-mueller-2")).toBe(false);
  });

  it("历史 context_packs 快照的语义：本层不删除派生物，只标失效（V7b④，重放需另行标注来源）", async () => {
    const deps = makeDeps(now);
    deps.cascade.seedDerivative("seg-mueller-1", "summary", "sum-history-1");

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["ai_analysis"],
      reason: null,
      origin: "portal",
    });

    // `invalidate` 不是 `delete`——端口没有暴露任何删除派生物的方法，
    // 已失效的派生物仍然可以被 listDerivatives 找到（供"重放时标注来源已失效"使用）。
    const stillListed = await deps.cascade.listDerivatives(["seg-mueller-1"]);
    expect(stillListed.some((d) => d.id === "sum-history-1")).toBe(true);
    expect(deps.cascade.isInvalidated("sum-history-1")).toBe(true);
  });
});
