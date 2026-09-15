/**
 * 把「材料 + 审阅任务」投进一条真实项目对话 —— MVP 架构第二版的唯一新增后端交互。
 *
 * 全部调用真实 chat API（`lib/live-chat.ts`，Wave 2 durable message + queued
 * AgentRun，`apps/api` 有真实 Postgres 支撑），不新增任何端点、不自建聊天 UI。
 * `agentId` 不是预先配置好的常量——按需解析/发布（`ensure-agent.ts`），不需要
 * 任何人手工登机器改库或改部署配置。
 */
import { createMessage, createPersonalThread, getAgentPanel, updateAgentRoster, uploadAttachment } from "@/lib/live-chat";
import { ensureTeam1AgentId } from "./ensure-agent";
import { buildReviewPrompt } from "./review-prompt";
import type { ReviewDocument } from "./types";

export interface LaunchReviewThreadInput {
  readonly files: readonly File[];
  /** 已经在浏览器侧读出过文本的材料（示例包场景），一并转成 File 再上传。 */
  readonly extraDocuments?: readonly ReviewDocument[];
}

export interface LaunchReviewThreadResult {
  readonly threadId: string;
}

/** 示例包场景下把纯文本材料包成 File，走同一条上传路径，不分叉出第二套逻辑。 */
function toFile(doc: ReviewDocument): File {
  return new File([doc.text], doc.name, { type: "text/plain" });
}

export async function launchReviewThread({
  files, extraDocuments = [],
}: LaunchReviewThreadInput): Promise<LaunchReviewThreadResult> {
  const agentId = await ensureTeam1AgentId();
  const thread = await createPersonalThread(`上会审阅 · ${new Date().toLocaleString("zh-CN")}`);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  const allFiles = [...files, ...extraDocuments.map(toFile)];
  const attachments = await Promise.all(allFiles.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildReviewPrompt(allFiles.map((f) => f.name)),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId };
}
