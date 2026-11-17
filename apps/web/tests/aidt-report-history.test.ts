import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { aidtReportHistoryMarkdown, collectAidtReportHistory, AIDT_REPORT_HISTORY_LIMITS, type AidtReportHistoryScope } from "@/features/aidt/lib/aidt-report-history";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mocks.list }));
const scope: AidtReportHistoryScope = { projectId: "p/1", orgId: "org", userId: "student", sessionToken: "token", lifecycleKey: "life" };
function saved(stageId: number, revision: number, fields: Record<string, string> = {}): AidtSharedStage {
  return { projectId: scope.projectId, stageId, revision, updatedBy: "student-a", updatedAt: "2026-11-16T00:00:00.000Z", sourceStageRevisions: [], content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: "" } } };
}
beforeEach(() => { mocks.list.mockReset(); });
afterEach(() => vi.useRealTimers());
it("collects multiple saved learning revisions, exact source revisions and student decisions without asserting completed rounds", async () => {
  const old = saved(6, 2, { returnStep: "undecided", returnReason: "需要补访谈", understandingChangeStatus: "insufficient", unresolvedQuestions: "缺少证据" });
  const latest = saved(6, 3, { returnStep: "2", returnReason: "回访", nextAction: "找反例" });
  latest.sourceStageRevisions = [{ stageId: 2, revision: 99 }];
  latest.content.draft.fields.questionSnapshot = JSON.stringify({ schemaVersion: 1, question: "是否易用？", beforeTestBelief: "尚未知", verificationBasis: "原型", verificationLimits: "无行为数据", prototypeRef: "prototype-A", sourceStageRevision: 2 });
  latest.content.summaryReport = { markdown: "不重复纳入旧报告", sourceStageRevisions: [] };
  mocks.list.mockImplementation(async (_p: string, stage: number) => ({ items: stage === 6 ? [latest, old] : stage === 5 ? [saved(5, 2, { verificationQuestion: "是否易用？" })] : [], nextBeforeRevision: null }));
  const history = await collectAidtReportHistory(scope, new AbortController().signal);
  const markdown = aidtReportHistoryMarkdown(history);
  expect(markdown).toContain("第6步 V2：草稿，尚待学生核对；暂未决定");
  expect(markdown).toContain("第6步 V3：草稿，尚待学生核对；返回第2步");
  expect(markdown.indexOf("第6步 V2：")).toBeLessThan(markdown.indexOf("第6步 V3："));
  expect(markdown).toContain("第5步 V2（本次已读取，内容仍待核对）");
  expect(markdown).toContain("第2步 V99（本次未读到");
  expect(markdown).toContain("没有服务器保存记录，材料缺失");
  expect(markdown).toContain("保存修订并非独立学习轮次");
  expect(markdown).toContain("来源缺口");
  expect(markdown).not.toContain("不重复纳入旧报告");
  expect(mocks.list.mock.calls.map(call => call[1])).toEqual([6, 1, 2, 3, 4, 5]);
  for (const call of mocks.list.mock.calls) expect([call[0], call[2], call[3].limit, call[4] instanceof AbortSignal]).toEqual(["p/1", "token", 5, true]);
});
it("bounds requests, history and excerpts and explicitly marks truncation", async () => {
  mocks.list.mockImplementation(async (_p: string, stage: number, _t: string, options: { beforeRevision?: number }) => {
    const top = (options.beforeRevision ?? 101) - 1;
    return { items: [0, 1, 2, 3, 4].map(n => saved(stage, top - n, { initial: "长".repeat(6000), understandingEvidence: "据".repeat(6000) })), nextBeforeRevision: top - 4 };
  });
  const history = await collectAidtReportHistory(scope, new AbortController().signal);
  expect(mocks.list).toHaveBeenCalledTimes(12);
  expect(history.stages.every(stage => stage.status === "truncated" && stage.entries.length === 10)).toBe(true);
  expect(history.stages[0]!.entries[0]!.excerptTruncated).toBe(true);
  const markdown = aidtReportHistoryMarkdown(history);
  expect(markdown).toContain("达到读取上限，历史已截断");
  expect(markdown).toContain("正文摘录已截断");
  expect(markdown.length).toBeLessThanOrEqual(AIDT_REPORT_HISTORY_LIMITS.chapterChars + 60);
});
it("keeps partial pages and distinguishes failures from truly empty stages", async () => {
  mocks.list.mockImplementation(async (_p: string, stage: number, _t: string, options: { beforeRevision?: number }) => {
    if (stage === 6 && !options.beforeRevision) return { items: [saved(6, 9)], nextBeforeRevision: 9 };
    if (stage === 6 || stage === 2) throw new Error("503");
    return { items: [], nextBeforeRevision: null };
  });
  const history = await collectAidtReportHistory(scope, new AbortController().signal);
  expect(history.stages[5]).toMatchObject({ status: "failed", entries: [{ revision: 9 }] });
  expect(history.stages[1]).toMatchObject({ status: "failed", entries: [] });
  expect(history.stages[0]!.status).toBe("missing");
  expect(aidtReportHistoryMarkdown(history)).toContain("读取失败或超时");
});
it.each([401, 403, 404])("discards all collected data on authorization failure %i", async status => {
  mocks.list.mockResolvedValueOnce({ items: [saved(6, 9)], nextBeforeRevision: null }).mockRejectedValueOnce(new ApiError(status, "FORBIDDEN", {}));
  await expect(collectAidtReportHistory(scope, new AbortController().signal)).rejects.toThrow("AIDT_HISTORY_ACCESS_DENIED");
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it("aborts without waiting for a transport which ignores cancellation and never continues to another stage", async () => {
  mocks.list.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController(), result = collectAidtReportHistory(scope, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.list.mock.calls[0]![4].aborted).toBe(true);
  expect(mocks.list).toHaveBeenCalledTimes(1);
});
it("times out non-cooperative requests and stops at the global time budget", async () => {
  vi.useFakeTimers(); mocks.list.mockReturnValue(new Promise(() => {}));
  const result = collectAidtReportHistory(scope, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(AIDT_REPORT_HISTORY_LIMITS.totalTimeoutMs + 1);
  const history = await result;
  expect(mocks.list).toHaveBeenCalledTimes(5);
  expect(history.stages.some(stage => stage.status === "not-read")).toBe(true);
  expect(history.stages.some(stage => stage.status === "failed")).toBe(true);
  expect(aidtReportHistoryMarkdown(history)).toContain("时间预算已用完，尚未读取");
});
it("rejects missing scope and already cancelled collection before issuing requests", async () => {
  await expect(collectAidtReportHistory({ ...scope, sessionToken: "" }, new AbortController().signal)).rejects.toThrow("AIDT_HISTORY_SCOPE_REQUIRED");
  const controller = new AbortController(); controller.abort();
  await expect(collectAidtReportHistory(scope, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.list).not.toHaveBeenCalled();
});
