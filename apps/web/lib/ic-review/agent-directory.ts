/**
 * Agent 目录 —— `/agent/<slug>` 落地页文案的单一事实源。
 *
 * MVP 架构（2026-09-15 第二版）：`/agent/team1` 不再是自建工作区，而是「材料预处理 +
 * 发起真实 chat 审阅任务」的启动页；审阅本身在真实项目对话里由挂载了 `agentId` 的
 * 已发布 Agent（真实模型）完成。
 *
 * ⚠ `agentId` 是后端 `agent-runtime` 里这个 Agent 发布后的真实数据库 id，**本文件
 * 不能替它造一个**。团队还没有在后台创建并发布 team1 这个 Agent 之前，这里必须是
 * `null`——落地页据此禁用「开始审阅」按钮并如实说明还差这一步，而不是假装能用。
 * 创建方式：`POST /agents`（`agentRuntime.operations.createAgent`）→
 * `POST /agents/:agentId/submit` → `POST /agents/:agentId/publish-decision`
 * （或 `self-publish`，见 `apps/api/src/interface/controllers/agent*.controller.ts`），
 * 拿到发布后的 id 填进来即可，不用改其他任何文件。
 */
export interface AgentDirectoryEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  /** 已发布 Agent 的真实 id；未发布前为 null，见上方文件头注。 */
  readonly agentId: string | null;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly boundaries: readonly string[];
}

export const AGENT_DIRECTORY: readonly AgentDirectoryEntry[] = [
  {
    slug: "team1",
    name: "上会材料智能审阅助手",
    tagline: "投决会前，把「读材料、查缺、找矛盾」的机械负担拿走；结论条条可回跳原文。",
    agentId: null,
    skills: ["ic-review-standard（上会标准 IC-1…IC-8，待发布为平台 Skill）"],
    capabilities: [
      "把材料作为附件发进一条真实项目对话，由挂载的模型完成审阅",
      "生成项目背景摘要与资料汇总提纲",
      "对照集团上会标准逐条比对，输出满足 / 部分满足 / 缺失 / 不适用",
      "跨文档交叉验证：显性矛盾、隐性异常、关联遗漏三类分开呈现",
      "在真实对话里按你的确认与分级做定向深挖",
    ],
    boundaries: [
      "不下投资结论、不给投/不投评级——只出事实、缺口与待追问事项",
      "材料里没有的事实只能进「需核实清单」，不得进「已满足」",
      "不修改、不回写上传的原始材料",
    ],
  },
];

export function findAgent(slug: string): AgentDirectoryEntry | undefined {
  return AGENT_DIRECTORY.find((a) => a.slug === slug);
}
