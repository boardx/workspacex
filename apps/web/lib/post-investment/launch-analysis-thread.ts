/**
 * 把「材料 + 投后报告任务」投进一条真实项目对话——全部调用真实 chat API
 * （`lib/live-chat.ts`），不新增任何端点、不自建聊天 UI。同 team1
 * （`lib/ic-review/launch-review-thread.ts`）的架构。
 */
import { createMessage, createPersonalThread, getAgentPanel, updateAgentRoster, uploadAttachment } from "@/lib/live-chat";
import { buildAnalysisPrompt } from "./analysis-prompt";
import { ensureTeam4AgentId } from "./ensure-agent";
import type { ReportDocument } from "./types";

export interface LaunchAnalysisThreadInput {
  readonly files: readonly File[];
  /** 已经在浏览器侧读出过文本的材料（示例包场景），一并转成 File 再上传。 */
  readonly extraDocuments?: readonly ReportDocument[];
}

export interface LaunchAnalysisThreadResult {
  readonly threadId: string;
}

function toFile(doc: ReportDocument): File {
  return new File([doc.text], doc.name, { type: "text/plain" });
}

export async function launchAnalysisThread({
  files, extraDocuments = [],
}: LaunchAnalysisThreadInput): Promise<LaunchAnalysisThreadResult> {
  const agentId = await ensureTeam4AgentId();
  const thread = await createPersonalThread(`投后报告 · ${new Date().toLocaleString("zh-CN")}`);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  const allFiles = [...files, ...extraDocuments.map(toFile)];
  const attachments = await Promise.all(allFiles.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildAnalysisPrompt(allFiles.map((f) => f.name)),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId };
}
