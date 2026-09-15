/**
 * 把 `/agent/team4` 解析成「一条已经配好的真实 chat 线程」—— 本 Agent 唯一的后端交互面。
 *
 * 入口只做三件在 chat UI 里做不了的事，做完直接把人送进真正的 chat：
 *
 * 1. 解析/发布 Agent（`ensure-agent.ts`），不需要任何人手工改库或改部署配置；
 * 2. 建一条个人线程，把这个 Agent 挂进 roster；
 * 3. 把「投后管理报告」Skill 挂进这条线程——方法论住在那个平台内置 Skill 里
 *    （`apps/api/scripts/post-investment-skill-content.ts` → seeding），不塞进
 *    instructions、也不每条消息重发一遍。
 *
 * 之后「传材料、提问、两轮确认、深挖」全部是普通 chat 操作，没有第二套 UI。
 * 同 team1 `lib/ic-review/ensure-review-thread.ts` 的架构与理由。
 *
 * ⚠ 用**个人线程**（`projectId: null`）：项目线程要求调用者在该项目里有写角色
 * （team3 在 devapp 上实测撞过整页 `NO_WRITE_ROLE`），而"能看见某个项目"跟"在那个
 * 项目里能写"是两件事。投后报告本来也是"我自己的分析助手"语义。
 *
 * 复用而不是每次新建：同一个人反复点入口（或刷新）不该堆出一串空线程，所以按标题
 * 在**服务端**搜一次既有线程（`listPersonalThreads({ q })`，不是在已加载的那一页里
 * 过滤）。要开一次全新的分析 → `/agent/team4?new=1`。
 */
import { createPersonalThread, getAgentPanel, listPersonalThreads, updateAgentRoster } from "@/lib/live-chat";
import { listThreadMounts, mountSkills } from "@/lib/live-skill-mount";
import { ensureTeam4AgentId } from "./ensure-agent";
import { POST_INVESTMENT_SKILL_ID } from "./skill-identity";

/** 线程标题即复用的判据——只认整串相等，不认前缀，避免吞掉用户自己改名的对话。 */
export const POST_INVESTMENT_THREAD_TITLE = "投后管理报告";

async function findExistingThreadId(): Promise<string | null> {
  const page = await listPersonalThreads({ q: POST_INVESTMENT_THREAD_TITLE });
  for (const group of page.groups) {
    for (const card of group.cards) {
      if (card.title === POST_INVESTMENT_THREAD_TITLE) return card.id;
    }
  }
  return null;
}

async function createConfiguredThread(): Promise<string> {
  const agentId = await ensureTeam4AgentId();
  const thread = await createPersonalThread(POST_INVESTMENT_THREAD_TITLE);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  // ⚠ `expectedVersion` 必须来自读端口，不能读不到就传空串兜底
  // （`live-skill-mount.ts` 头注的乐观锁纪律）。
  const mounts = await listThreadMounts(threadId, undefined);
  await mountSkills(threadId, undefined, {
    skillIds: [POST_INVESTMENT_SKILL_ID], expectedVersion: mounts.version,
  });

  return threadId;
}

/**
 * @param forceNew `/agent/team4?new=1` —— 跳过复用，开一条全新的分析对话。
 */
export async function ensurePostInvestmentThreadId(forceNew = false): Promise<string> {
  if (!forceNew) {
    const existing = await findExistingThreadId();
    if (existing) return existing;
  }
  return createConfiguredThread();
}
