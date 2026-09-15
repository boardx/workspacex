/**
 * Agent 目录 —— `/agent/<slug>` 落地页文案的单一事实源。
 *
 * MVP 架构（2026-09-15 第三版）：`/agent/team1` 不再是自建工作区，而是「材料预处理 +
 * 发起真实 chat 审阅任务」的启动页；审阅本身在真实项目对话里由挂载了真实 Agent 的
 * 已发布模型完成。
 *
 * ⚠ 这里**不再声明一个固定的 `agentId`**——第二版曾经要求「运维手工在目标环境跑
 * 一次发布脚本、改 deploy.env、重新部署」，人类反馈这太麻烦、也不想手工碰数据库。
 * 现在改成按需自动发布：`ensure-agent.ts` 在真正点「开始审阅」时才通过真实
 * `POST /agents` / `.../self-publish` 端点解析或创建它，跟任何一个 org admin 用户
 * 在后台手动建一个 Agent 是同一条路径，只是自动做一遍，不是手工改库。
 * 每个部署环境（本机 / devapp / 生产）各自的库里，第一个点「开始审阅」的
 * org admin 用户就把这一步做完了，后面所有人直接复用同一个 Agent。
 */
export interface AgentDirectoryEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly boundaries: readonly string[];
}

export const AGENT_DIRECTORY: readonly AgentDirectoryEntry[] = [
  {
    slug: "team1",
    name: "上会材料智能审阅助手",
    tagline: "投决会前，把「读材料、查缺、找矛盾」的机械负担拿走；结论条条可回跳原文。",
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
