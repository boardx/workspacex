import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { loadAidtSummaryContext, aidtSummaryRequest } from "@/features/aidt/lib/aidt-summary-context";
import { aidtReportChatHref } from "@/features/aidt/lib/aidt-report-task";
const mocks = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read }));
vi.mock("@/features/aidt/lib/aidt-report-history", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-report-history")>(), collectAidtReportHistory: mocks.history }));
const scope = { projectId: "p", orgId: "o", userId: "u", sessionToken: "token", lifecycleKey: "life" };
beforeEach(() => {
  mocks.read.mockReset(); mocks.history.mockReset();
  mocks.read.mockImplementation(async (_p, stageId) => ({ stage: { projectId: "p", stageId, revision: stageId, sourceStageRevisions: [], content: { schemaVersion: 1, draft: { ...emptyAidtUiDrafts()[stageId]!, fields: stageId === 1 ? { initial: "学生初始题", whyWorthStudying: "学生的价值反思", problemSources: '["guess"]' } : stageId === 5 ? { verificationQuestion: "本轮确切问题", version: "原型A" } : {} } } } }));
  mocks.history.mockResolvedValue({ projectId: "p", collectedAt: "2026-11-16T00:00:00Z", stages: [1,2,3,4,5,6].map(stageId => ({ stageId, status: "missing", entries: stageId === 6 ? [{ stageId: 6, revision: 1, sourceStageRevisions: [], updatedBy: "u", updatedAt: "2026-11-16T00:00:00Z", excerpt: "旧返工原因：先补访谈", excerptTruncated: false, learning: { confirmed: false, decision: "暂未决定，待支持", questionRevision: 2 } }] : [] })) });
});
it("loads six real saved stage revisions and learning history, preserves V2 reflection and marks teacher material absent", async () => {
  const signal = new AbortController().signal;
  const result = await loadAidtSummaryContext(scope, signal);
  expect(result.currentStages.map(row => row.revision)).toEqual([1,2,3,4,5,6]);
  expect(result.currentStages[0]!.markdown).toContain("学生的价值反思"); expect(result.currentStages[4]!.markdown).toContain("本轮确切问题");
  expect(result.historyRevisions).toEqual([{stageId:6,revision:1}]); expect(result.historyMarkdown).toContain("先补访谈"); expect(result.teacherComments).toBeNull();
  const request = aidtSummaryRequest(result);
  expect(request).toContain("请生成本组研究过程报告的学生审阅稿");
  expect(request).toContain("第1步 V1、第2步 V2、第3步 V3、第4步 V4、第5步 V5、第6步 V6");
  expect(request).toContain("教师点评尚无授权来源");
  expect(request).toContain("等待学生选择导入，不自动保存");
  for (const call of mocks.read.mock.calls) expect([call[0],call[2],call[3]]).toEqual(["p","token",signal]);
  expect(mocks.history).toHaveBeenCalledWith(scope, signal);
});
it("distinguishes missing from failed stages rather than inventing their contents", async () => {
  mocks.read.mockImplementation(async (_p, id) => { if (id === 2) throw new Error("503"); return { stage: null }; });
  const result = await loadAidtSummaryContext(scope,new AbortController().signal);
  expect(result.currentStages).toEqual([]); expect(result.failedStages).toEqual([2]); expect(result.missingStages).toEqual([1,3,4,5,6]);
});
it.each([401,403,404])("does not return any previously loaded stage text after denial %i", async status => {
  mocks.read.mockRejectedValueOnce(new ApiError(status,"FORBIDDEN",{}));
  await expect(loadAidtSummaryContext(scope,new AbortController().signal)).rejects.toBeInstanceOf(ApiError);
  expect(mocks.history).not.toHaveBeenCalled();
});
it("preserves separate stage and SUM thread parameters without adding a seventh step", () => {
  const url = new URL(aidtReportChatHref("p",{threadId:"sum",stageThread:"iterate",tool:"report"}),"http://local");
  expect(url.searchParams.get("step")).toBe("6"); expect(url.searchParams.get("summaryThread")).toBe("sum"); expect(url.searchParams.get("thread")).toBe("iterate");
});
