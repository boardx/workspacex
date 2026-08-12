export type TranscriptionTag = "客户" | "内部" | "高优先级" | "已归档" | "市场研究";

export interface TranscriptionHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly owner: string;
  readonly ownerInitial: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly duration: string;
  readonly updatedAt: string;
  readonly status: "idle" | "recording" | "completed" | "failed";
}

export const TRANSCRIPTION_TAGS: readonly TranscriptionTag[] = [
  "客户", "内部", "高优先级", "已归档", "市场研究",
];

export const MOCK_TRANSCRIPTION_TOTAL = 18;

export const MOCK_TRANSCRIPTIONS: readonly TranscriptionHistoryItem[] = [
  { id: "europe-entry", title: "欧洲市场进入讨论", project: "欧洲市场进入项目", owner: "林可", ownerInitial: "欧", summary: "本次会议聚焦欧洲市场进入策略，讨论了目标国家选择、合规要求与合作渠道。", tags: ["客户", "市场研究"], duration: "58:12", updatedAt: "2026/08/11", status: "completed" },
  { id: "roadmap-review", title: "产品路线图评审会", project: "产品团队", owner: "高琪", ownerInitial: "李", summary: "评审 Q4 路线图与关键里程碑，明确资源分配与风险处理方式。", tags: ["内部"], duration: "50:11", updatedAt: "2026/08/10", status: "completed" },
  { id: "germany-retail", title: "客户访谈 · 德国零售客户", project: "德国零售客户项目", owner: "黄宇", ownerInitial: "张", summary: "了解客户在库存管理、供应链可视化方面的主要困难与采购标准。", tags: ["客户", "高优先级"], duration: "42:08", updatedAt: "2026/08/09", status: "completed" },
  { id: "q2-retro", title: "内部复盘 · Q2 项目总结", project: "运营团队", owner: "陈曦", ownerInitial: "王", summary: "回顾 Q2 项目执行情况，总结成功经验与需要持续改进的环节。", tags: ["内部"], duration: "47:36", updatedAt: "2026/08/09", status: "completed" },
  { id: "partner-sync", title: "合作伙伴对齐会", project: "渠道合作伙伴项目", owner: "林可", ownerInitial: "欧", summary: "对齐合作计划与市场推广节奏，明确双方职责与下一步动作。", tags: ["客户", "高优先级"], duration: "41:05", updatedAt: "2026/08/08", status: "completed" },
  { id: "tech-review", title: "技术方案评审", project: "技术平台项目", owner: "刘畅", ownerInitial: "刘", summary: "评估实时处理架构的容量与容错方案，确认关键技术验证节点。", tags: ["内部"], duration: "55:20", updatedAt: "2026/08/07", status: "completed" },
  { id: "italy-research", title: "用户研究访谈 · 意大利用户", project: "用户研究项目", owner: "李然", ownerInitial: "赵", summary: "收集意大利用户对产品体验的反馈与建议，形成后续研究输入。", tags: ["市场研究", "客户"], duration: "30:12", updatedAt: "2026/08/06", status: "completed" },
  { id: "pricing", title: "定价策略讨论", project: "商业分析", owner: "高琪", ownerInitial: "周", summary: "讨论不同市场的定价策略、竞争对标与折扣边界。", tags: ["内部", "高优先级"], duration: "39:44", updatedAt: "2026/08/05", status: "completed" },
  { id: "south-europe", title: "南欧市场机会分析", project: "市场研究", owner: "黄宇", ownerInitial: "陈", summary: "分析南欧市场规模、增长趋势与进入壁垒，整理可验证的机会假设。", tags: ["市场研究", "内部"], duration: "48:28", updatedAt: "2026/08/04", status: "completed" },
  { id: "support-retro", title: "客户支持复盘", project: "客户成功团队", owner: "陈曦", ownerInitial: "孙", summary: "复盘典型支持案例，优化响应流程与知识库内容。", tags: ["客户"], duration: "36:18", updatedAt: "2026/08/03", status: "completed" },
  { id: "quarter-plan", title: "季度计划沟通会", project: "管理层例会", owner: "林可", ownerInitial: "林", summary: "确认下季度目标、负责人和跨团队依赖，统一关键结果口径。", tags: ["内部", "已归档"], duration: "44:52", updatedAt: "2026/08/02", status: "completed" },
];
