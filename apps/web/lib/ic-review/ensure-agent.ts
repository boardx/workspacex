/**
 * 按需发布 team1 这个 Agent —— 全部走真实前端 API，不是手工改库。
 *
 * 用户明确要求：不要为了拿到一个真实 `agentId`就得有人 SSH 上机器、跑独立脚本、
 * 改 `deploy.env`、触发重新部署。真正需要的只是「这个 Agent 在当前登录用户所在的
 * 组织里存在且已发布」——这件事本来就有对应的真实端点（`POST /agents` /
 * `PATCH .../instructions` / `POST .../self-publish`），跟当前登录用户点开
 * Studio 后台建一个 Agent 是同一条路径，只是这里自动做一遍，不用人手点五次表单。
 *
 * 幂等：按名字在当前组织里查，找到已发布的直接复用；没有才建。任何一个环境
 * （本机 / devapp / 生产），第一个打开 `/agent/team1` 并点「开始审阅」的 org admin
 * 用户就把这一步做完了，后面所有人（含非 admin）直接复用同一个 agentId。
 *
 * ⚠ `listAgents`/`createAgent` 服务端只放行 org admin（`ROLE_INSUFFICIENT`）——
 * 非 admin 用户调用会失败，这里原样把错误抛出去，由调用方决定怎么降级
 * （`ic-review-launcher.tsx` 降级成「复制审阅任务书」兜底，不是本模块的职责）。
 */
import { createAgentFromScratch, listAgents, selfPublishAgent, setAgentInstructions } from "@/lib/agent-definition";
import { buildReviewPrompt } from "./review-prompt";

const AGENT_NAME = "上会材料智能审阅助手";

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
  await setAgentInstructions(created.agentId, buildReviewPrompt([]));
  await selfPublishAgent(created.agentId);
  return created.agentId;
}

export function ensureTeam1AgentId(): Promise<string> {
  if (!cached) {
    cached = resolve().catch((error) => { cached = null; throw error; });
  }
  return cached;
}
