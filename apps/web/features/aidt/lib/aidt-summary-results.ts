import { chat } from "@repo/contracts";
import { listMessages, listThreadArtifacts, getThreadArtifactSource } from "@/lib/live-chat";
import { resolveAidtStepChat } from "./live-aidt-step-chat";
import { AIDT_STEPS } from "./project-aidt";
import type { AidtReportHistoryScope } from "./aidt-report-history";
import { readAidtRunContext } from "./live-aidt-run-context";
import type { AidtContextReceipt } from "@repo/contracts/aidt-run-context";

export type AidtSummaryChoice = { kind: "message" | "artifact"; id: string; messageId: string; runId: string; title: string; markdown?: string; version?: number | null; mode?: string };
export type AidtSummarySourceReview = { status: "available"; receipt: AidtContextReceipt } | { status: "unavailable" };
const referenceLabel = (row: { stageId: number; revision: number }) => `第${row.stageId}步 V${row.revision}`;
/** Software provenance, separate from the selected model's unchanged report body. */
export function aidtSummarySourceReviewLines(review: AidtSummarySourceReview): string[] {
  if (review.status === "unavailable") return ["运行材料回执未能读取，无法核对本轮版本与截断范围。请回到原生对话核对来源，不将未知范围写成完整读取。"];
  const receipt = review.receipt;
  const omitted = receipt.omissions.map(row => {
    const source = row.stageId ? `第${row.stageId}步${row.revision ? ` V${row.revision}` : ""}：` : "";
    const label = { missing: "材料缺失", "not-selected": "未选入本轮", truncated: "仅传入部分摘录，未读剩余内容", "personal-artifacts-not-included": "个人产物未自动纳入", "original-file-bytes-not-read": "未读取原始文件字节", "teacher-comments-no-source": "教师点评无来源", "lineage-unknown": "版本继承关系未经核实" }[row.kind];
    return `${source}${label}${row.note ? `（${row.note}）` : ""}`;
  });
  const dispatched = receipt.application.state === "message-dispatch-observed";
  return [
    `本轮固定版本：${receipt.stageRevisions.map(referenceLabel).join("、") || "无"}。`,
    `历史版本：${receipt.historyRevisions.map(referenceLabel).join("、") || "无"}。`,
    receipt.truncated ? "来源已截断：选中版本不等于全文已读，未读内容须回原材料核对。" : "回执未标记摘录截断；这不代表已读取原文件或全部历史。",
    ...omitted,
    dispatched ? "已观测本轮请求发送；不代表AI正确覆盖了这些材料。" : `运行应用状态：${receipt.application.state}；尚不能据此确认本轮材料已发送给模型。`,
    "请逐项核对旧轮次、原型文件／版本与测试前后认识；本轮固定版本不代表当前最新版。原型notes／制作说明是声明，须核对实际文件；静态图不证明可点击或真实用户行为。软件不代替学生确认报告事实。",
  ];
}
const check = (signal: AbortSignal) => { if (signal.aborted) throw new Error("AIDT_CONTEXT_CHANGED"); };
/** Read only the mounted SUM thread. Human text and unlinked artifacts are never AI report results. */
export async function loadAidtSummaryChoices(scope: AidtReportHistoryScope, threadId: string, signal: AbortSignal, entityId?: string) {
  check(signal);
  const verified = await resolveAidtStepChat({ ...scope, step: AIDT_STEPS[5], purpose: "report", thread: threadId, entityId, signal }); check(signal);
  if (entityId && verified.threadId !== threadId) throw new Error("AIDT_SUMMARY_THREAD_MISMATCH");
  const messages: ReturnType<typeof chat.operations.listMessages.out.parse>["messages"] = [];
  let cursor: string | undefined; const seen = new Set<string>(); let truncated = false;
  for (let page = 0; page < 3; page++) {
    const response = chat.operations.listMessages.out.parse(await listMessages(threadId, { cursor, limit: 100 }, scope.sessionToken)); check(signal);
    messages.push(...response.messages);
    if (response.nextCursor === null) break;
    if (seen.has(response.nextCursor)) throw new Error("AIDT_SUMMARY_CURSOR_INVALID");
    seen.add(response.nextCursor); cursor = response.nextCursor; truncated = page === 2;
  }
  const ai = messages.filter(message => message.authorKind === "agent" && message.agentRunId && message.text.trim());
  const byId = new Map(ai.map(message => [message.id, message]));
  const choices: AidtSummaryChoice[] = ai.map(message => ({ kind: "message", id: message.id, messageId: message.id, runId: message.agentRunId!, title: `AI消息 · ${message.createdAt}`, markdown: message.text }));
  // Artifact failure does not erase real messages; the omission is visible.
  let artifactsUnavailable = false;
  try {
    const artifacts = chat.operations.listThreadArtifacts.out.parse(await listThreadArtifacts(threadId, scope.projectId, scope.sessionToken)); check(signal);
    for (const artifact of artifacts.items.slice(0, 20)) {
      const message = byId.get(artifact.messageId);
      if (artifact.hasSource && message?.agentRunId) choices.push({ kind: "artifact", id: artifact.artifactId, messageId: artifact.messageId, runId: message.agentRunId, title: artifact.title, version: artifact.version, mode: artifact.mode });
    }
    truncated ||= artifacts.items.length > 20;
  } catch (error) {
    check(signal);
    // Authorization revocation must clear all candidate rows, including messages.
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    if (status === 401 || status === 403 || status === 404) throw error;
    artifactsUnavailable = true;
  }
  return { choices, truncated, artifactsUnavailable };
}
/** Explicit selection is reauthorized/read back before import; this operation never lands/saves anything. */
export async function readAidtSummaryChoice(scope: AidtReportHistoryScope, threadId: string, selected: AidtSummaryChoice, signal: AbortSignal, entityId?: string) {
  const current = await loadAidtSummaryChoices(scope, threadId, signal, entityId); check(signal);
  const choice = current.choices.find(item => item.kind === selected.kind && item.id === selected.id && item.messageId === selected.messageId && item.runId === selected.runId);
  if (!choice) throw new Error("AIDT_SUMMARY_RESULT_CHANGED");
  let markdown: string, immutableRevision: string | null = null;
  if (choice.kind === "artifact") {
    const source = chat.operations.getThreadArtifactSource.out.parse(await getThreadArtifactSource(threadId, choice.id, scope.projectId, scope.sessionToken)); check(signal);
    if (source.version !== selected.version) throw new Error("AIDT_SUMMARY_RESULT_CHANGED");
    markdown = source.markdown; immutableRevision = source.immutableRevision;
  } else {
    if (choice.markdown !== selected.markdown) throw new Error("AIDT_SUMMARY_RESULT_CHANGED");
    markdown = choice.markdown!;
  }
  if (!markdown.trim() || markdown.length > 85000) throw new Error("AIDT_SUMMARY_RESULT_SIZE");
  let sourceReview: AidtSummarySourceReview;
  try {
    const receipt = await readAidtRunContext({ projectId: scope.projectId, runId: choice.runId }, scope.sessionToken, signal); check(signal);
    if (receipt.purpose !== "summary") throw new Error("AIDT_SUMMARY_RECEIPT_TASK_MISMATCH");
    sourceReview = { status: "available", receipt };
  } catch (error) {
    check(signal);
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    if (status === 401 || status === 403 || (error instanceof Error && /MISMATCH/.test(error.message))) throw error;
    // A missing/failed receipt never becomes a claim that the whole source was read.
    sourceReview = { status: "unavailable" };
  }
  return { choice, markdown, immutableRevision, sourceReview };
}
export function aidtSummaryImportMarkdown(threadId: string, result: Awaited<ReturnType<typeof readAidtSummaryChoice>>) {
  return ["## AI报告草稿 · 学生选择导入", "", "以下内容来自已保存的总结对话，尚待学生核对和修改；模型陈述不是原始证据、教师点评或文件导出回执。阶段来源请核对该对话的生成请求与材料范围。", `对话：${threadId}；消息：${result.choice.messageId}；运行：${result.choice.runId}${result.immutableRevision ? `；产物：${result.choice.id}；修订：${result.immutableRevision}` : ""}`, "", "### 软件记录的来源范围（不是AI报告正文）", ...aidtSummarySourceReviewLines(result.sourceReview).map(line => `- ${line}`), "", "### 所选AI原文（未经软件改写）", "", result.markdown, ""].join("\n");
}

/** A teaching question or welcome reply is not a report document. */
export function isAidtReportDraft(markdown: string) {
  const lines = markdown.trim().split(/\r?\n/);
  return /^#{1,6}\s+.*报告/.test(lines[0] ?? "") && lines.slice(1).some(line => line.trim());
}

export async function readAidtChatReportDraft(scope: AidtReportHistoryScope, entityId: string, threadId: string, messageId: string, signal: AbortSignal) {
  const { choices } = await loadAidtSummaryChoices(scope, threadId, signal, entityId);
  const linked = choices.filter(choice => choice.messageId === messageId);
  const artifact = linked.find(choice => choice.kind === "artifact" && /报告/.test(choice.title));
  const message = linked.find(choice => choice.kind === "message" && isAidtReportDraft(choice.markdown ?? ""));
  const selected = artifact ?? message;
  if (!selected) return null;
  return readAidtSummaryChoice(scope, threadId, selected, signal, entityId);
}
