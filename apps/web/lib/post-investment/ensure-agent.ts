/**
 * 按需发布 team4 这个 Agent —— 全部走真实前端 API，不是手工改库。逐字复用
 * `lib/ic-review/ensure-agent.ts`（team1）已验证的架构：`createAgentFromScratch`/
 * `listAgents`/`setAgentInstructions`/`selfPublishAgent` 与任何 org admin 在后台
 * 手动建一个 Agent 走的是同一条真实路径，只是自动做一遍。幂等：按名字在当前组织里
 * 查，找到已发布的直接复用；没有才建。
 *
 * ⚠ 服务端 `createAgent`/`listAgents` 只放行 org admin（`ROLE_INSUFFICIENT`）——
 * 非 admin 用户调用会失败，这里原样抛出，由调用方（`post-investment-launcher.tsx`）
 * 决定怎么降级。
 */
import { createAgentFromScratch, listAgents, selfPublishAgent, setAgentInstructions } from "@/lib/agent-definition";
import { buildAnalysisPrompt } from "./analysis-prompt";

const AGENT_NAME = "投后管理报告 AI 生成单元";

let cached: Promise<string> | null = null;

async function resolve(): Promise<string> {
  const existing = await listAgents({});
  const found = existing.find((a) => a.name === AGENT_NAME);
  if (found) return found.agentId;

  const created = await createAgentFromScratch({
    name: AGENT_NAME, initials: "PI",
    role: "投后管理报告 AI 生成单元，读投后材料、算财务趋势、查受限渠道外部信息、做跨文件风险交叉验证、出投后报告，只出事实/风险/前置条件，不给退出结论",
    roleLabel: "投后报告助手", visibility: "全组织可用", cloneFrom: null,
  });
  await setAgentInstructions(created.agentId, buildAnalysisPrompt([]));
  await selfPublishAgent(created.agentId);
  return created.agentId;
}

export function ensureTeam4AgentId(): Promise<string> {
  if (!cached) {
    cached = resolve().catch((error) => { cached = null; throw error; });
  }
  return cached;
}
