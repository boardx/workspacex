/**
 * 把「材料 + 评级任务」投进一条真实项目对话 —— 唯一的新增交互，全部调用真实 chat
 * API（`lib/live-chat.ts`），不新增任何后端端点、不自建聊天 UI。同 team1
 * （`lib/ic-review/launch-review-thread.ts`）的架构。
 *
 * 不做客户端预解析：`chat-file-upload` 的 MIME 白名单已经包含 pdf/xlsx/pptx/docx
 * （`packages/contracts/src/chat-file-upload.ts`），文件作为真实附件直接上传，交给
 * 挂载在 Agent 上的模型用 `wx_document_parse`（native 工具，任何真实 agent run 都有）
 * 自己读——不重复实现一遍。
 */
import type { postinvestRating } from "@repo/contracts";

type MissingDataReason = postinvestRating.MissingDataReason;
import { createMessage, createThread, getAgentPanel, updateAgentRoster, uploadAttachment } from "@/lib/live-chat";
import { buildRatingPrompt } from "./rating-prompt";

export interface LaunchRatingThreadInput {
  readonly agentId: string;
  /**
   * 评级所属的真实项目（R3-1）。此前建的是个人线程，评级与项目无关联——评级记录、
   * 历史趋势、权限（R5 的「项目成员」判定）全都无处挂靠。同 team3
   * （`components/agent/team3-start-chat-button.tsx`）用真实项目线程。
   */
  readonly projectId: string;
  readonly projectName: string;
  readonly files: readonly File[];
  /** R3-3 的「数据缺失说明」表单结果；人工确认事实，随任务书一起投进对话。 */
  readonly missingReason?: MissingDataReason;
}

export interface LaunchRatingThreadResult {
  readonly threadId: string;
  readonly projectId: string;
}

export async function launchRatingThread({
  agentId, projectId, projectName, files, missingReason,
}: LaunchRatingThreadInput): Promise<LaunchRatingThreadResult> {
  const thread = await createThread({
    projectId,
    groupId: null,
    title: `投后评级 · ${projectName} · ${new Date().toLocaleDateString("zh-CN")}`,
    visibilityScope: "private",
  });
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, projectId);
  await updateAgentRoster(threadId, projectId, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  const attachments = await Promise.all(files.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildRatingPrompt(files.map((f) => f.name), missingReason, projectName),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId, projectId };
}
