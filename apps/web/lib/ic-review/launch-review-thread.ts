/**
 * 把「材料 + 审阅任务」投进一条真实项目对话 —— 本 Agent 唯一的后端交互面。
 *
 * 全部调用真实 chat API（`lib/live-chat.ts` / `lib/live-skill-mount.ts`，Wave 2
 * durable message + queued AgentRun + 真实 `thread_skill_mounts`，`apps/api` 有真实
 * Postgres 支撑），不新增任何端点、不自建聊天 UI。
 *
 * 四步，顺序有意义：
 * 1. 解析/发布 Agent（`ensure-agent.ts`）——不需要任何人手工登机器改库或改部署配置；
 * 2. 建线程 + 把 Agent 挂进 roster；
 * 3. **把「上会审阅」Skill 挂进这条线程**——审阅方法论住在这个平台内置 Skill 里
 *    （`apps/api/src/infrastructure/skill/ensure-ic-review-skill.ts`），不塞进
 *    instructions、也不每条消息重发一遍；
 * 4. 传附件 + 发一条只说「这次审哪些材料」的触发消息。
 */
import { createMessage, createPersonalThread, getAgentPanel, updateAgentRoster, uploadAttachment } from "@/lib/live-chat";
import { listThreadMounts, mountSkills } from "@/lib/live-skill-mount";
import { ensureTeam1AgentId } from "./ensure-agent";
import { buildReviewKickoffMessage } from "./review-prompt";
import { IC_REVIEW_SKILL_ID } from "./skill-identity";
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

  // 挂「上会审阅」Skill。⚠ `expectedVersion` 必须来自读端口，不能读不到就传空串兜底
  // （`live-skill-mount.ts` 头注的乐观锁纪律）。
  const deviations = await listThreadMounts(threadId, undefined);
  await mountSkills(threadId, undefined, {
    skillIds: [IC_REVIEW_SKILL_ID], expectedVersion: deviations.version,
  });

  const allFiles = [...files, ...extraDocuments.map(toFile)];
  const attachments = await Promise.all(allFiles.map((f) => uploadAttachment(threadId, f)));

  await createMessage(threadId, {
    clientMessageId: crypto.randomUUID(),
    text: buildReviewKickoffMessage(allFiles.map((f) => f.name)),
    agentId,
    attachmentIds: attachments.map((a) => a.id),
  });

  return { threadId };
}
