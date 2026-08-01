/**
 * F89 —— 五步撤回编排 + 两级 SLA（D-13/D-15）+ D-19 对外人工确认（uc-6-3 R4/A4）。
 *
 * 刻意不碰 Postgres：本 feature 涉及的持久化地基尚未落地为 Postgres 实现，
 * 按 issue #74 的允许口径，这里用内存双工件对编排断言。见
 * `in-memory-withdrawal-repository.ts` 头部注释。
 *
 * 本文件要证明的核心断言（对应 issue 的「反证」要求）：
 *   ① 五步恒定存在，01–03 在同一次调用内完成、02/03 的 dueAt 是同一条 D-15
 *      「逻辑失效 ≤5 分钟」的截止时限（唯一事实源 `WITHDRAWAL_SLA_MS`）；
 *   ② 第 04 步存在受影响的已签字决策时停在 needs-human，绝不自动变成 done；
 *   ③ 第 05 步只入队，物理删除真正完成前 `issueDeletionReceipt` 恒拒绝；
 *   ④ D-19：已发布的报告引用只被标内部失效 + 排队待确认，不会被自动替换；
 *   ⑤ 同一受访者、范围有交集的撤回在途时拒绝重复受理；
 *   ⑥ 全流程任何地方都不出现「24 小时」这个已废弃的时限。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { WITHDRAWAL_SLA_MS } from "@repo/contracts/org-admin";
import { requestWithdrawal } from "../../src/application/interview/request-withdrawal";
import { getWithdrawalStatus } from "../../src/application/interview/get-withdrawal-status";
import { issueDeletionReceipt } from "../../src/application/interview/issue-deletion-receipt";
import { WithdrawalInProgressError, ErasureNotCompleteError } from "../../src/application/interview/errors";
import {
  FixedWithdrawalSegmentLocator,
  InMemoryCascadeInvalidationStore,
  InMemoryPendingDeletionQueue,
  InMemoryReportSegmentAnnotator,
  InMemoryRetrievalIndex,
  InMemorySignedDecisionReviewNotifier,
  InMemoryWithdrawalRepository,
} from "../../src/infrastructure/interview/in-memory-withdrawal-repository";

const SUBJECT = "sub-f89-weber";

function makeDeps(now: () => Date) {
  const withdrawals = new InMemoryWithdrawalRepository();
  const segments = new FixedWithdrawalSegmentLocator(new Map([[SUBJECT, ["seg-1", "seg-2"]]]));
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
    newWithdrawalId: () => `wd-test-${++seq}`,
  };
}

describe("F89 · 五步撤回编排 + 两级 SLA", () => {
  let clockMs: number;
  const now = () => new Date(clockMs);

  beforeEach(() => {
    clockMs = Date.parse("2026-08-01T09:00:00.000Z");
  });

  it("V7 ①②③：01–03 即时完成，dueAt 来自 D-15 逻辑失效 ≤5 分钟这一单一事实源", async () => {
    const deps = makeDeps(now);

    const result = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });

    expect(result.steps).toHaveLength(5);
    const [s1, s2, s3, s4, s5] = result.steps as [
      (typeof result.steps)[number],
      (typeof result.steps)[number],
      (typeof result.steps)[number],
      (typeof result.steps)[number],
      (typeof result.steps)[number],
    ];

    expect(s1.no).toBe(1);
    expect(s1.state).toBe("done");
    expect(s1.dueAt).toBe(now().toISOString());

    const logicalDeadline = new Date(now().getTime() + WITHDRAWAL_SLA_MS.logicalRetire).toISOString();
    expect(s2.state).toBe("done");
    expect(s2.dueAt).toBe(logicalDeadline);
    expect(s3.state).toBe("done");
    expect(s3.dueAt).toBe(logicalDeadline);

    // 02：片段真的退出检索、主题矩阵重算被触发
    expect(deps.retrieval.excludedSegmentIds.has("seg-1")).toBe(true);
    expect(deps.retrieval.topicMatrixRecomputedFor).toContain(SUBJECT);

    // 04：无受影响决策 ⇒ done，不悬空
    expect(s4.no).toBe(4);
    expect(s4.state).toBe("done");
    expect(s4.dueAt).toBeNull();

    // 05：只入队，dueAt = D-15 物理删除 ≤30 天
    const physicalDeadline = new Date(now().getTime() + WITHDRAWAL_SLA_MS.physicalDelete).toISOString();
    expect(s5.state).toBe("pending");
    expect(s5.dueAt).toBe(physicalDeadline);
    expect(deps.deletionQueue.tickets).toHaveLength(1);
    expect(deps.deletionQueue.tickets[0]?.withdrawalId).toBe(result.withdrawalId);
  });

  it("V7④：支撑过已签字决策时第 04 步 needs-human，绝不自动改结论", async () => {
    const deps = makeDeps(now);
    deps.decisionReview.seedDecision("seg-1", { decisionId: "dec-1", approverId: "user-approver" });

    const result = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["ai_analysis"],
      reason: "受访者主动撤回",
      origin: "portal",
    });

    const step4 = result.steps.find((s) => s.no === 4)!;
    expect(step4.state).toBe("needs-human");
    expect(step4.dueAt).toBeNull(); // ⚠ 没有系统能强制的截止时限——只有催办，没有自动化

    expect(deps.decisionReview.createdReviewTasks).toHaveLength(1);
    expect(deps.decisionReview.createdReviewTasks[0]).toMatchObject({
      decisionId: "dec-1",
      approverId: "user-approver",
      withdrawalId: result.withdrawalId,
    });
    // 决策本身不存在"结论被系统改写"这种对象——本用例没有暴露任何改结论的接口，
    // 复核任务是唯一产出。
  });

  it("D-19：已发布的报告引用只标内部失效 + 排队待人工确认，不自动替换", async () => {
    const deps = makeDeps(now);
    deps.reportAnnotator.seedReference("seg-1", { kind: "report-section", id: "rs-1", published: true });
    deps.reportAnnotator.seedReference("seg-2", { kind: "report-section", id: "rs-2", published: false });

    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript", "ai_analysis"],
      reason: null,
      origin: "staff-assisted",
    });

    // 两者都被标"证据已撤回"（对内可见），段落本身没有被删除——这里只断言"标记发生过"，
    // 数据结构上没有"delete"这个操作可调用，说明段落不可能被静默删除。
    expect(deps.reportAnnotator.markedWithdrawn.has("rs-1")).toBe(true);
    expect(deps.reportAnnotator.markedWithdrawn.has("rs-2")).toBe(true);

    // 只有已发布的那一条进了"待人工确认后替换"队列——非发布的不需要外部确认。
    expect(deps.reportAnnotator.pendingExternalConfirmation).toEqual(["rs-1"]);
  });

  it("第 05 步真正完成前，issueDeletionReceipt 恒拒绝（E3）", async () => {
    const deps = makeDeps(now);
    const result = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["record"],
      reason: null,
      origin: "portal",
    });

    await expect(
      issueDeletionReceipt(deps, { withdrawalId: result.withdrawalId }),
    ).rejects.toBeInstanceOf(ErasureNotCompleteError);

    // 外部（22-files/17-gov）真正删完文件层后回写，回执才能发出。
    clockMs += 20 * 24 * 60 * 60_000; // +20 天，仍在 ≤30 天窗口内
    await deps.withdrawals.markPhysicalDeleteComplete(result.withdrawalId, now());

    const receipt = await issueDeletionReceipt(deps, { withdrawalId: result.withdrawalId });
    expect(receipt.scope).toEqual(["record"]);
    expect(receipt.completedAt).toBe(now().toISOString());
    expect(receipt.verifiableId).toMatch(/^wrcpt-/);

    const status = await getWithdrawalStatus(deps, { withdrawalId: result.withdrawalId });
    expect(status.steps.find((s) => s.no === 5)?.state).toBe("done");
  });

  it("同一受访者、范围有交集的撤回在途时拒绝重复受理（WITHDRAWAL_IN_PROGRESS）", async () => {
    const deps = makeDeps(now);
    await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });

    await expect(
      requestWithdrawal(deps, {
        subjectId: SUBJECT,
        scope: ["transcript", "record"],
        reason: null,
        origin: "portal",
      }),
    ).rejects.toBeInstanceOf(WithdrawalInProgressError);
  });

  it("撤回完成（第 05 步 done）后，同受访者可以再次发起新的撤回", async () => {
    const deps = makeDeps(now);
    const first = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript"],
      reason: null,
      origin: "portal",
    });
    await deps.withdrawals.markPhysicalDeleteComplete(first.withdrawalId, now());

    const second = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["record"],
      reason: null,
      origin: "portal",
    });
    expect(second.withdrawalId).not.toBe(first.withdrawalId);
  });

  it("反证：全流程任何断言/产出字符串中都不出现「24 小时」这个已废弃口径", async () => {
    const deps = makeDeps(now);
    const result = await requestWithdrawal(deps, {
      subjectId: SUBJECT,
      scope: ["transcript", "record", "ai_analysis", "attribution"],
      reason: "全撤回反证",
      origin: "portal",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("24 小时");
    expect(serialized).not.toContain("小时");
    expect(serialized).not.toMatch(/24h\b/i);

    // 两级 SLA 的截止时限只可能是 D-15 的两个数值：≤5 分钟（逻辑失效）或 ≤30 天（物理删除）。
    const step2 = result.steps.find((s) => s.no === 2)!;
    const step5 = result.steps.find((s) => s.no === 5)!;
    const minutesToStep2 = (Date.parse(step2.dueAt!) - clockMs) / 60_000;
    const daysToStep5 = (Date.parse(step5.dueAt!) - clockMs) / (24 * 60 * 60_000);
    expect(minutesToStep2).toBe(5);
    expect(daysToStep5).toBe(30);
  });
});
