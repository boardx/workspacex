/**
 * Agent 目录 —— `/agent/<slug>` 落地页文案的单一事实源。
 *
 * MVP 架构（2026-09-15 第二版）：`/agent/team1` 不再是自建工作区，而是「材料预处理 +
 * 发起真实 chat 审阅任务」的启动页；审阅本身在真实项目对话里由挂载了 `agentId` 的
 * 已发布 Agent（真实模型）完成。
 *
 * ⚠ `agentId` 是后端 `agent-runtime` 里这个 Agent 发布后的真实数据库 id，**本文件
 * 不能替它造一个**——每个部署环境（本机开发库 / devapp / 生产）各自有自己的库，
 * id 天然不跨环境通用。二选一：
 *   ① 设置构建时环境变量 `NEXT_PUBLIC_TEAM1_AGENT_ID`（推荐，换环境不用改代码）；
 *   ② 直接改下面 `agentId` 的字面量（本机开发临时验证时更快）。
 * 都没设时保持 `null`——落地页据此禁用「开始审阅」按钮并如实说明还差这一步。
 *
 * 发布方式：`apps/api/scripts/publish-team1-agent.ts`（幂等，一条命令跑完
 * 创建 → 写 instructions → self-publish，2026-09-15 已在真实 Postgres + Redis +
 * apps/api 实例上验证过整条链路：建 Agent → 挂进线程 roster → 发消息 → 收到
 * 202 与 queued AgentRun）。
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
    agentId: process.env.NEXT_PUBLIC_TEAM1_AGENT_ID ?? null,
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
