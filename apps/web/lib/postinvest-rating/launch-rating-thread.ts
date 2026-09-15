/**
 * 把「材料 + 评级任务」投进一条真实项目对话 —— 唯一的新增交互，全部调用真实 chat
 * API（`lib/live-chat.ts`），不新增任何后端端点、不自建聊天 UI。同 team1
 * （`lib/ic-review/ensure-review-thread.ts`）的架构。
 *
 * 不做客户端预解析：`chat-file-upload` 的 MIME 白名单已经包含 pdf/xlsx/pptx/docx
 * （`packages/contracts/src/chat-file-upload.ts`），文件作为真实附件直接上传，交给
 * 挂载在 Agent 上的模型用 `wx_document_parse`（native 工具，任何真实 agent run 都有）
 * 自己读——不重复实现一遍。
 */
import { createMessage, createPersonalThread, getAgentPanel, updateAgentRoster, uploadAttachment } from "@/lib/live-chat";
import { buildRatingPrompt } from "./rating-prompt";

export interface LaunchRatingThreadInput {
  readonly agentId: string;
  readonly files: readonly File[];
}

export interface LaunchRatingThreadResult {
  readonly threadId: string;
}

export async function launchRatingThread({ agentId, files }: LaunchRatingThreadInput): Promise<LaunchRatingThreadResult> {
  const thread = await createPersonalThread(`投后评级 · ${new Date().toLocaleString("zh-CN")}`);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  const attachments = await Promise.all(files.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildRatingPrompt(files.map((f) => f.name)),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId };
}
