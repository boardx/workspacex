/**
 * 把「材料 + 评级任务」投进一条真实项目对话 —— 唯一的新增交互，全部调用真实 chat
 * API（`lib/live-chat.ts`），不新增任何后端端点、不自建聊天 UI。同 team1
 * （`lib/ic-review/ensure-review-thread.ts`）的架构。
 *
 * ⚠ 2026-09-15 人类实测 403 后改回个人线程（`createPersonalThread`），并去掉项目选择：
 * 绑项目那条路要求调用者在该项目里有**非 observer 的成员角色**（`mutate-thread.ts` 的
 * `NO_WRITE_ROLE`——「观察者恒无写权，接口拒绝，不只是按钮不渲染」），而选择器是用
 * `listProjects`（**可见性**）填的。可见 ≠ 可写：组织管理员能看见全部项目，却可能一个
 * 都不能写（本仓「管理员不是超级用户」）。于是「所有人都能用」被前端自己挡住了。
 * 个人线程是 `mutate-thread.ts` 的第一条分支，任何登录用户都能建，不需要项目成员资格。
 * 记忆协议的检索键改由模型从材料里读出的公司名担任，趋势对比照常成立。
 *
 * 不做客户端预解析：`chat-file-upload` 的 MIME 白名单已经包含 pdf/xlsx/pptx/docx
 * （`packages/contracts/src/chat-file-upload.ts`），文件作为真实附件直接上传，交给
 * 挂载在 Agent 上的模型用 `wx_document_parse`（native 工具，任何真实 agent run 都有）
 * 自己读——不重复实现一遍。
 */
import type { postinvestRating } from "@repo/contracts";

type MissingDataReason = postinvestRating.MissingDataReason;
import {
  createMessage, createPersonalThread, getAgentPanel, updateAgentRoster, uploadAttachment,
} from "@/lib/live-chat";
import { buildRatingPrompt } from "./rating-prompt";

export interface LaunchRatingThreadInput {
  readonly agentId: string;
  readonly files: readonly File[];
  /** R3-3 的「数据缺失说明」表单结果；人工确认事实，随任务书一起投进对话。 */
  readonly missingReason?: MissingDataReason;
}

export interface LaunchRatingThreadResult {
  readonly threadId: string;
}

export async function launchRatingThread({
  agentId, files, missingReason,
}: LaunchRatingThreadInput): Promise<LaunchRatingThreadResult> {
  const thread = await createPersonalThread(`投后评级 · ${new Date().toLocaleString("zh-CN")}`);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  const attachments = await Promise.all(files.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildRatingPrompt(files.map((f) => f.name), missingReason),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId };
}
