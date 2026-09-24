/**
 * 把 `/agent/team1` 解析成「一条已经配好的真实 chat 线程」—— 本 Agent 唯一的后端交互面。
 *
 * 2026-09-15 第五版（人类原话：「你就是一个 agent，入口点击以后，会打开类似 chatui
 * 的界面，可以用所有的 chat 的能力，但是这个是 team1 的 agent」）：入口不再是一个
 * 自建的「上传材料 + 开始审阅」落地页——那是把 chat 已有的能力（附件、历史、重试、
 * 产物落地、`#` 挂载浮层…）在旁边又实现了一遍的窄版。现在入口只做三件在 chat UI
 * 里做不了的事，做完直接把人送进真正的 chat：
 *
 * 1. 解析/发布 Agent（`ensure-agent.ts`），不需要任何人手工改库或改部署配置；
 * 2. 建一条个人线程，把这个 Agent 挂进 roster；
 * 3. 把「上会审阅」Skill 挂进这条线程——审阅方法论住在那个平台内置 Skill 里
 *    （`apps/api/src/infrastructure/skill/ensure-ic-review-skill.ts`），不塞进
 *    instructions、也不每条消息重发一遍。
 *
 * 之后「传材料、提问、两轮确认」全部是普通 chat 操作，没有第二套 UI。
 *
 * ⚠ 解析结果是「线程 + Agent」两件事实，不是只有线程——理由见下方 `IcReviewSession`。
 *
 * 复用而不是每次新建：同一个人反复点入口（或刷新）不该堆出一串空线程，所以按标题
 * 在**服务端**搜一次既有线程（`listPersonalThreads({ q })`，不是在已加载的那一页里
 * 过滤）。要开一次全新的审阅 → `/agent/team1?new=1`。
 */
import { createPersonalThread, getAgentPanel, listPersonalThreads, updateAgentRoster } from "@/lib/live-chat";
import { listThreadMounts, mountSkills, unmountSkill } from "@/lib/live-skill-mount";
import { ensureTeam1AgentId } from "./ensure-agent";
import { IC_REVIEW_SKILL_ID, IC_REVIEW_SKILL_VERSION_ID } from "./skill-identity";

/** 线程标题即复用的判据——只认整串相等，不认前缀，避免吞掉用户自己改名的对话。 */
export const IC_REVIEW_THREAD_TITLE = "上会材料审阅";

async function findExistingThreadId(): Promise<string | null> {
  const page = await listPersonalThreads({ q: IC_REVIEW_THREAD_TITLE });
  for (const group of page.groups) {
    for (const card of group.cards) {
      if (card.title === IC_REVIEW_THREAD_TITLE) return card.id;
    }
  }
  return null;
}

/**
 * 线程挂载是**钉版本**的（服务端 `mount-skill-to-thread.ts` 存的是挂载当刻的
 * `currentVersionId`）。所以 Skill 正文升版本之后，老线程仍然钉着旧版本——
 * 2026-09-16 真机踩到的第二层：即便种子把 v2 发布出去，一条 2026-09-15 建的
 * 「上会材料审阅」线程照旧按 v1 回答，用户看不到新加的任务五。
 *
 * 复用线程时因此要对一次版本：挂的不是当前版本就摘掉重挂。摘除是打时间戳不是删行
 * （契约 `ThreadSkillMount.removedAt` 头注），历史消息的角标不受影响。
 */
async function ensureCurrentSkillMounted(threadId: string): Promise<void> {
  const mounts = await listThreadMounts(threadId, undefined);
  const mine = mounts.temporary.filter((m) => m.skillId === IC_REVIEW_SKILL_ID && m.removedAt === null);
  const current = mine.find((m) => m.versionId === IC_REVIEW_SKILL_VERSION_ID);
  if (current) return;

  for (const stale of mine) await unmountSkill(threadId, stale.mountId, undefined);
  // ⚠ 摘除会改挂载列表的乐观锁版本号，必须重新读一次再挂，不能复用上面那个。
  const after = await listThreadMounts(threadId, undefined);
  await mountSkills(threadId, undefined, {
    skillIds: [IC_REVIEW_SKILL_ID], expectedVersion: after.version,
  });
}

async function createConfiguredThread(): Promise<IcReviewSession> {
  const agentId = await ensureTeam1AgentId();
  const thread = await createPersonalThread(IC_REVIEW_THREAD_TITLE);
  const threadId = thread.threadId;

  const panel = await getAgentPanel(threadId, null);
  await updateAgentRoster(threadId, null, {
    add: [agentId], remove: [], expectedRosterVersion: panel.rosterVersion,
  });

  // ⚠ `expectedVersion` 必须来自读端口，不能读不到就传空串兜底
  // （`live-skill-mount.ts` 头注的乐观锁纪律）。
  const mounts = await listThreadMounts(threadId, undefined);
  await mountSkills(threadId, undefined, {
    skillIds: [IC_REVIEW_SKILL_ID], expectedVersion: mounts.version,
  });

  return { threadId, agentId };
}

/**
 * 一次会话所需的两件事实。
 *
 * ⚠ `agentId` 必须一起交出去，不能只给 `threadId`——2026-09-15 本入口与 team4 在
 * devapp 真机上各栽一次的同一个缺陷：把 Agent 挂进 roster 只决定「这条线程编制里有谁」，
 * 「不决定这次请求用哪个 agent」。后者看的是 chat 的 `selectedAgentId`
 * （→ `COPILOTKIT_V2_SELECTED_AGENT_HEADER` → 服务端 `resolveEffectiveAgentId`）。
 * 不选中，服务端就落到 org 动态默认（通用助手）回答——本 Agent 的 instructions 与挂载的
 * 「上会审阅」Skill 一行都没进 system prompt，用户看到的是一个泛泛的助手。
 */
export interface IcReviewSession {
  readonly threadId: string;
  readonly agentId: string;
}

/**
 * @param forceNew `/agent/team1?new=1` —— 跳过复用，开一条全新的审阅对话。
 */
export async function ensureIcReviewSession(forceNew = false): Promise<IcReviewSession> {
  if (!forceNew) {
    const existing = await findExistingThreadId();
    // 复用既有线程时同样要拿到 agentId（解析是幂等的，命中缓存不额外打请求）。
    if (existing) {
      const agentId = await ensureTeam1AgentId();
      // 老线程可能钉着旧版本的 Skill——对一次版本，不一致就换挂（理由见函数头注）。
      await ensureCurrentSkillMounted(existing);
      return { threadId: existing, agentId };
    }
  }
  return createConfiguredThread();
}
