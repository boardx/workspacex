import { ApiError } from "@/lib/api-client";
import { aidtUiStageSummary } from "./aidt-ui-drafts";
import { listAidtStageHistory, type AidtSharedStage } from "./live-aidt-stages";
import { isAidtReflectionConfirmed, readAidtQuestionSnapshot, readAidtReturnDecision } from "./aidt-verification-loop";

export type AidtReportHistoryScope = { projectId: string; orgId: string; userId: string; sessionToken: string; lifecycleKey: string };
export const AIDT_REPORT_HISTORY_LIMITS = { pageSize: 5, pagesPerStage: 2, requestTimeoutMs: 4000, totalTimeoutMs: 20000, excerptChars: 1200, chapterChars: 85000 } as const;
type HistoryEntry = Pick<AidtSharedStage, "stageId" | "revision" | "sourceStageRevisions" | "updatedAt" | "updatedBy"> & {
  excerpt: string; excerptTruncated: boolean;
  learning?: { confirmed: boolean; decision: string; questionRevision: number | null };
};
export type AidtHistoryStage = { stageId: number; status: "complete" | "missing" | "failed" | "truncated" | "not-read"; entries: HistoryEntry[] };
export type AidtReportHistory = { projectId: string; collectedAt: string; stages: AidtHistoryStage[] };
const abortError = () => new DOMException("History read cancelled", "AbortError");

/** Also bounds a non-cooperative transport: neither cancellation nor a timeout waits for fetch. */
async function readPage(projectId: string, stageId: number, token: string, beforeRevision: number | undefined, signal: AbortSignal, timeoutMs: number) {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const stop = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(abortError()); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error("AIDT_HISTORY_TIMEOUT")); }, timeoutMs);
  });
  try {
    return await Promise.race([listAidtStageHistory(projectId, stageId, token, { beforeRevision, limit: AIDT_REPORT_HISTORY_LIMITS.pageSize }, controller.signal), stop]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
function entry(stage: AidtSharedStage): HistoryEntry {
  const summary = aidtUiStageSummary(stage.stageId, stage.content.draft) || "已保存空草稿；材料缺失。";
  const clipped = summary.length > AIDT_REPORT_HISTORY_LIMITS.excerptChars;
  const decision = readAidtReturnDecision(stage.content.draft);
  return {
    stageId: stage.stageId, revision: stage.revision, sourceStageRevisions: stage.sourceStageRevisions,
    updatedAt: stage.updatedAt, updatedBy: stage.updatedBy,
    excerpt: clipped ? `${summary.slice(0, AIDT_REPORT_HISTORY_LIMITS.excerptChars)}\n[正文摘录已截断；请回本步历史核对完整原稿]` : summary,
    excerptTruncated: clipped,
    ...(stage.stageId === 6 ? { learning: {
      confirmed: isAidtReflectionConfirmed(stage.content.draft),
      decision: decision.kind === "selected" ? `返回第${decision.step}步 · ${decision.label}` : decision.kind === "undecided" ? "暂未决定，待支持" : "尚未填写下一步",
      questionRevision: readAidtQuestionSnapshot(stage.content.draft)?.sourceStageRevision ?? null,
    } } : {}),
  };
}

/** Six authorized stage endpoints, at most 12 requests / 60 saved revisions. No writes or evidence inference. */
export async function collectAidtReportHistory(scope: AidtReportHistoryScope, signal: AbortSignal): Promise<AidtReportHistory> {
  if (!scope.projectId || !scope.sessionToken || !scope.orgId || !scope.userId) throw new Error("AIDT_HISTORY_SCOPE_REQUIRED");
  const deadline = Date.now() + AIDT_REPORT_HISTORY_LIMITS.totalTimeoutMs;
  const stages: AidtHistoryStage[] = [1, 2, 3, 4, 5, 6].map(stageId => ({ stageId, status: "not-read", entries: [] }));
  // Read learning records first; they anchor actual decisions and historical prototype references.
  for (const stageId of [6, 1, 2, 3, 4, 5]) {
    if (signal.aborted) throw abortError();
    const state = stages[stageId - 1]!;
    let beforeRevision: number | undefined;
    for (let pageNumber = 0; pageNumber < AIDT_REPORT_HISTORY_LIMITS.pagesPerStage; pageNumber++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { if (state.entries.length) state.status = "truncated"; break; }
      try {
        const page = await readPage(scope.projectId, stageId, scope.sessionToken, beforeRevision, signal, Math.min(remaining, AIDT_REPORT_HISTORY_LIMITS.requestTimeoutMs));
        if (signal.aborted) throw abortError();
        state.entries.push(...page.items.map(entry));
        state.status = page.nextBeforeRevision === null ? state.entries.length ? "complete" : "missing" : "truncated";
        if (page.nextBeforeRevision === null) break;
        beforeRevision = page.nextBeforeRevision;
      } catch (error) {
        if (signal.aborted) throw abortError();
        // Access revocation invalidates every previously collected row, even from another stage.
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) throw new Error("AIDT_HISTORY_ACCESS_DENIED");
        state.status = "failed";
        break;
      }
    }
  }
  return { projectId: scope.projectId, collectedAt: new Date().toISOString(), stages };
}

const statusText: Record<AidtHistoryStage["status"], string> = {
  complete: "本次分页范围已读完（不代表研究已验证）", missing: "没有服务器保存记录，材料缺失",
  failed: "读取失败或超时；已读内容可能不完整", truncated: "达到读取上限，历史已截断", "not-read": "时间预算已用完，尚未读取",
};
export function aidtReportHistoryMarkdown(history: AidtReportHistory): string {
  const available = new Set(history.stages.flatMap(stage => stage.entries.map(row => `${row.stageId}:${row.revision}`)));
  const reference = (stageId: number, revision: number) => `第${stageId}步 V${revision}（${available.has(`${stageId}:${revision}`) ? "本次已读取，内容仍待核对" : "本次未读到；可能缺失、失败或被截断，不能补称已核对"}）`;
  const lines = ["## 历史学习追溯 · 服务器保存记录", "", `项目：${history.projectId}；读取时间：${history.collectedAt}`, "当前报告前文保留学生当前编辑，可能含未保存草稿；本章仅摘录服务器历史。保存和学生确认均不等于测试成功、教师认可或研究证据成立。", "每步最多读取最近10个保存修订，正文每版最多摘录1200字；保存修订并非独立学习轮次，不能据此推算完成轮数。历史中保存的旧报告正文不重复纳入，也不生成教师点评或原始证据。", "", "### 学习轮次与学生决定", "按第6步保存修订追溯学习记录。同一轮可能保存多次；没有明确关联的修订，其轮次关系未决定。", ""];
  const learning = history.stages.find(stage => stage.stageId === 6)!;
  for (const row of [...learning.entries].reverse()) {
    lines.push(`第6步 V${row.revision}：${row.learning?.confirmed ? "编辑者已确认学习记录" : "草稿，尚待学生核对"}；${row.learning?.decision}。`, `原问题来源：${row.learning?.questionRevision ? reference(5, row.learning.questionRevision) : "缺少原问题的共享版本引用"}。`);
  }
  if (!learning.entries.length) lines.push("尚未读取可用的第6步历史学习记录；不补造轮次或决定。");
  for (const stage of history.stages) {
    lines.push("", `### 第${stage.stageId}步历史 · ${statusText[stage.status]}`);
    for (const row of [...stage.entries].reverse()) {
      lines.push("", `共享 V${row.revision} · ${row.updatedAt} · 保存者 ${row.updatedBy}`, `实际保存的前序引用：${row.sourceStageRevisions.length ? row.sourceStageRevisions.map(ref => reference(ref.stageId, ref.revision)).join("；") : "未绑定，保留来源缺口"}`, row.excerpt);
    }
  }
  const markdown = lines.join("\n");
  return markdown.length > AIDT_REPORT_HISTORY_LIMITS.chapterChars ? `${markdown.slice(0, AIDT_REPORT_HISTORY_LIMITS.chapterChars)}\n[章节长度达到上限，内容已截断；须回各步历史核对]\n` : markdown;
}
