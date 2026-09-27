import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

/** Only consumed by the guarded development preview. All values are samples. */
export function prototypeRuntime(): GuidedResearchRuntime {
  const titles = ["执行摘要", "研究范围与方法", "市场规模与增长动能", "政策与落地约束", "竞争格局与进入路径", "综合结论", "建议与展望"];
  const outline = titles.map((title, order) => ({
    id: `chapter-${order}`, title, order, enabled: true,
    objective: order === 0 ? "以简洁、清晰的方式呈现研究的核心结论、关键发现和主要建议，帮助读者快速了解研究的价值与意义。" : "基于来源证据回答本章问题，并说明研究局限。",
    questions: order === 0 ? ["研究的核心问题是什么？", "我们得出了哪些关键结论？", "这些结论对行业、企业或相关方意味着什么？", "我们提出了哪些重要建议？"] : [`如何评估${title}？`],
    subsections: ["研究背景与问题概述", "核心发现", "主要结论", "关键建议"].map((name, index) => ({ id: `sub-${order}-${index}`, title: name, questions: ["需要验证哪些证据？"] })),
  }));
  const tasks = outline.flatMap((chapter, index) => Array.from({ length: index === 3 ? 8 : 6 }, (_, order) => ({
    id: `task-${index}-${order}`, sectionId: chapter.id, query: `storage policy ${index} ${order}`,
    status: index < 3 || index === 3 && order < 4 ? "succeeded" as const : index === 3 && order === 4 ? "running" as const : "pending" as const,
    attempts: 1, errorCode: null,
  })));
  const sources = ["行业研究报告", "政策文件", "市场数据与统计"].map((title, index) => ({
    id: `sample-source-${index}`, taskId: tasks[index]!.id, title, url: `https://example.org/sample-${index}`,
    content: "视觉预览样本，不作为真实证据。", retrievedAt: "2024-03-28", decision: "accepted" as const,
  }));
  return {
    sessionId: "visual-sample", version: 1, revision: 1, currentNode: "report",
    availableNodes: ["brief", "directions", "outline", "research", "report"],
    generatedNodes: ["brief", "directions", "outline", "research", "report"],
    brief: { topic: "中国企业进入欧洲储能市场的策略研究", goal: "分析欧洲储能市场的市场现状、政策环境、竞争格局与发展趋势，识别中国企业进入欧洲市场的机会与挑战，并提出可行的市场进入策略与实施建议。", timeRange: "近 3 年（2022–2024 年）", region: "欧洲（欧盟及重点国家：德国、法国、英国等）", focus: "市场增长质量、政策确定性、竞争强度、投融资环境" },
    directions: [], outline, tasks, sources, completed: false, busy: false, leaseUntil: null, errorCode: null,
    intent: { decision: "评估进入策略", audience: "决策团队", timeframe: { from: "2022-01-01", to: "2024-12-31" }, deliverable: "研究报告", successCriteria: ["全面覆盖核心问题，提供清晰、结构化的分析结论", "基于可靠的数据和资料，保留证据引用", "提供可落地的建议或启示，具有实际参考价值", "报告结构清晰，逻辑严谨，便于理解"] },
    planRevision: 1, sourcePolicy: { mode: "prioritize", domains: ["example.org"], internalSourceIds: [], revision: 1 },
    report: { title: "欧洲储能市场进入策略综合评估与证据局限性分析", summary: "本报告围绕中国企业进入欧洲储能市场的可行性与策略选择，基于多维度数据与案例研究，系统分析市场现状、驱动因素、竞争格局与政策环境，并从市场进入路径、商业模式、风险因素等方面进行综合评估，提出具有可操作性的建议。\n\n研究发现，不同国家在政策机制、市场需求和竞争格局方面存在显著差异。研究结论应结合当地市场的真实证据与试点验证进一步完善。", sections: outline.map((chapter) => ({ sectionId: chapter.id, body: "本章基于资料研究的结果，提炼本研究的核心发现，讨论市场增长趋势、政策环境与竞争格局，并说明结论的适用范围及研究局限。", sourceIds: sources.map((source) => source.id) })) },
    controlStatus: "running",
    activity: Array.from({ length: 8 }, (_, index) => ({ id: `activity-${index}`, sequence: index, status: "succeeded" as const, taskId: tasks[index]!.id, stage: index % 3 === 0 ? "searching" as const : index % 3 === 1 ? "reading" as const : "validating" as const, occurredAt: `2024-03-28T06:${String(28 - index * 2).padStart(2, "0")}:00Z`, summary: index % 3 === 0 ? "搜索储能市场与政策相关资料…" : index % 3 === 1 ? "阅读行业报告与公开政策文件" : "交叉核查来源，整理关键发现" })),
    messages: [], proposal: null, modelCalls: [],
  };
}
