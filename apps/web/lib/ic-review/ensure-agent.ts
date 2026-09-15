/**
 * 按需准备好 team1 这个 Agent —— 全部走真实前端 API，不是手工改库。
 *
 * 按名字在当前组织里找，没有就 `POST /agents` 建、写一句 identity 级 instructions、
 * `self-publish` 发布。幂等：任何一个环境（本机 / devapp / 生产），第一个打开
 * `/agent/team1` 并点「开始审阅」的 org admin 用户就把这一步做完了，后面所有人
 * （含非 admin）直接复用同一个 agentId。
 *
 * ⚠ **审阅方法论不在这里**：它是一个平台内置 Skill（`ic-review-standard`，正文与
 * 种子见 `apps/api/src/infrastructure/skill/ensure-ic-review-skill.ts`），由
 * `launch-review-thread.ts` 在**线程级**挂载。
 *
 * 为什么是线程级而不是 `setAgentSkillPins`（agent 级钉版本）：实测确认
 * （2026-09-15，真实 Postgres + apps/api）`pg-agent-skill-pins-repository.ts` 的
 * 校验 SQL 是 `WHERE org_id = $1`（agent 自己的组织），**不含 `PLATFORM_ORG_ID`**，
 * 所以平台组织下的 skill 一律 `SKILL_VERSION_NOT_FOUND`——四个官方 Office skill
 * 同样钉不上去，它们本来也是走线程挂载（chat composer 的 `#` 挂载浮层）被用的。
 * 线程挂载（`POST /threads/:threadId/skill-mounts`）实测可以挂平台组织的 skill。
 *
 * ⚠ `listAgents`/`createAgent` 服务端只放行 org admin（`ROLE_INSUFFICIENT`）——
 * 非 admin 用户调用会失败，这里原样把错误抛出去，由调用方决定怎么降级
 * （`ic-review-launcher.tsx` 降级成「复制审阅任务书」兜底）。
 */
import { createAgentFromScratch, listAgents, selfPublishAgent, setAgentInstructions } from "@/lib/agent-definition";

const AGENT_NAME = "上会材料智能审阅助手";
/** Agent 自身只留一句身份说明；「怎么审阅」在挂载的 Skill 里，不在这里重复。 */
const AGENT_INSTRUCTIONS =
  "你是「上会材料智能审阅助手」，服务于集团投决会前的材料审阅。" +
  "具体的审阅标准、交叉验证要求、输出格式与两轮人工确认流程，以本次对话挂载的「上会审阅」技能为准，按它执行。" +
  "只陈述事实、缺口与待追问事项，不给投资建议或投/不投评级。";

/** 单个浏览器标签页内缓存一次解析结果，避免同一次会话里重复打「列表 + 建」两轮请求。 */
let cached: Promise<string> | null = null;

async function resolve(): Promise<string> {
  const existing = await listAgents({});
  const found = existing.find((a) => a.name === AGENT_NAME);
  if (found) return found.agentId;

  const created = await createAgentFromScratch({
    name: AGENT_NAME, initials: "IC",
    role: "上会材料智能审阅助手，读材料、对照上会标准查缺、跨文档交叉验证找矛盾，只出事实与追问不给投资结论",
    roleLabel: "审阅助手", visibility: "全组织可用", cloneFrom: null,
  });
  await setAgentInstructions(created.agentId, AGENT_INSTRUCTIONS);
  await selfPublishAgent(created.agentId);
  return created.agentId;
}

export function ensureTeam1AgentId(): Promise<string> {
  if (!cached) {
    cached = resolve().catch((error) => { cached = null; throw error; });
  }
  return cached;
}
