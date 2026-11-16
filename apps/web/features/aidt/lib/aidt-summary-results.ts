import { chat } from "@repo/contracts";
import { listMessages, listThreadArtifacts, getThreadArtifactSource } from "@/lib/live-chat";
import { resolveAidtStepChat } from "./live-aidt-step-chat";
import { AIDT_STEPS } from "./project-aidt";
import type { AidtReportHistoryScope } from "./aidt-report-history";

export type AidtSummaryChoice = { kind: "message" | "artifact"; id: string; messageId: string; runId: string; title: string; markdown?: string; version?: number | null; mode?: string };
const check = (signal: AbortSignal) => { if (signal.aborted) throw new Error("AIDT_CONTEXT_CHANGED"); };
/** Read only the mounted SUM thread. Human text and unlinked artifacts are never AI report results. */
export async function loadAidtSummaryChoices(scope: AidtReportHistoryScope, threadId: string, signal: AbortSignal) {
  check(signal);
  await resolveAidtStepChat({ ...scope, step: AIDT_STEPS[5], purpose: "report", thread: threadId, signal }); check(signal);
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
export async function readAidtSummaryChoice(scope: AidtReportHistoryScope, threadId: string, selected: AidtSummaryChoice, signal: AbortSignal) {
  const current = await loadAidtSummaryChoices(scope, threadId, signal); check(signal);
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
  return { choice, markdown, immutableRevision };
}
export function aidtSummaryImportMarkdown(threadId: string, result: Awaited<ReturnType<typeof readAidtSummaryChoice>>) {
  return ["## AI报告草稿 · 学生选择导入", "", "以下内容来自已保存的总结对话，尚待学生核对和修改；模型陈述不是原始证据、教师点评或文件导出回执。阶段来源请核对该对话的生成请求与材料范围。", `对话：${threadId}；消息：${result.choice.messageId}；运行：${result.choice.runId}${result.immutableRevision ? `；产物：${result.choice.id}；修订：${result.immutableRevision}` : ""}`, "", result.markdown, ""].join("\n");
}
