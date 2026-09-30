/**
 * 内置工作流 —— 面向用户的中文显示名单源（运行详情页 + 工作流权限页共用）。
 *
 * 运行时 / 目录里的 workflowKey（`problem-to-prd`）、workflowId（`W029`）与阶段 id
 * （`frame_gate`、`solutions_fill`）都是技术标识，不直接上屏；这里给它们配中文名。
 * 目录新增而这里没写时走兜底（阶段 → 「步骤 N」，工作流 → 目录 title），不白屏、不漏 id。
 */

interface WorkflowName {
  readonly workflowId: string;
  readonly key: string;
  readonly name: string;
}

const WORKFLOWS: readonly WorkflowName[] = [
  { workflowId: "W002", key: "meeting-to-actions", name: "会议纪要转行动项" },
  { workflowId: "W027", key: "discovery-to-opportunity", name: "探索发现到机会评估" },
  { workflowId: "W028", key: "research-to-insight", name: "用户研究到洞察" },
  { workflowId: "W029", key: "problem-to-prd", name: "问题定义到 PRD" },
  { workflowId: "W030", key: "prd-to-sprint", name: "PRD 到迭代计划" },
  { workflowId: "W031", key: "experiment-loop", name: "实验闭环" },
  { workflowId: "W032", key: "roadmap-review", name: "路线图评审" },
];

/** 按 workflowKey 或 workflowId（大小写不敏感）找到内置工作流；找不到返回 null。 */
export function findBuiltinWorkflow(keyOrId: string): WorkflowName | null {
  const q = keyOrId.trim().toLowerCase();
  return WORKFLOWS.find((w) => w.key === q || w.workflowId.toLowerCase() === q) ?? null;
}

/** 工作流显示名：优先中文名，其次目录 title，最后才是 key。 */
export function workflowDisplayName(keyOrId: string, fallbackTitle?: string): string {
  return findBuiltinWorkflow(keyOrId)?.name ?? fallbackTitle ?? keyOrId;
}

const STAGES: Record<string, string> = {
  activation_define: "定义激活指标",
  adjudicate: "裁决分歧",
  analyze: "分析数据",
  apply: "应用变更",
  approve_actions: "审批行动项",
  audit: "审计核查",
  collect: "收集材料",
  commit_gate: "承诺确认（审批）",
  commit_proposal: "提交方案",
  competition: "竞品分析",
  coverage_check: "覆盖度检查",
  data_lock: "锁定数据",
  decide: "做出决策",
  demand_check: "需求验证",
  design: "设计方案",
  diagnose: "问题诊断",
  draft: "起草文档",
  estimate: "工作量估算",
  estimation_gate: "估算确认（审批）",
  external_view: "外部视角",
  extract: "提取要点",
  fieldwork: "实地调研",
  frame: "界定问题",
  frame_gate: "问题界定确认（审批）",
  gaps_gate: "缺口确认（审批）",
  gather: "汇集信息",
  handoff: "交接",
  health_check: "健康检查",
  hex: "六维评估",
  hypothesize: "提出假设",
  import_outline: "导入访谈提纲",
  intake: "接收需求",
  integrate: "整合结论",
  kpi: "制定指标",
  kpi_bind: "绑定指标",
  launch_attest: "上线确认",
  map: "梳理机会",
  metric_audit: "指标核查",
  notify: "发送通知",
  outcome_review: "结果复盘",
  persist: "保存产出文档",
  plan: "制定计划",
  plan_gate: "计划确认（审批）",
  plan_interviews: "规划访谈",
  planning: "迭代规划",
  prd_gate: "PRD 确认（审批）",
  precheck: "前置检查",
  preregister: "实验预注册",
  prioritize: "排定优先级",
  publish: "发布",
  publish_plan: "发布计划",
  publish_record: "发布记录",
  readiness: "就绪检查",
  readout: "结果解读",
  recompute: "重新计算",
  reconcile: "核对对账",
  record: "记录",
  record_review: "记录复核",
  replan: "重新规划",
  rerank: "重新排序",
  retention_followup: "留存跟进",
  review_insight: "复核洞察",
  review_plan: "复核计划",
  revise: "修订",
  scope: "界定范围",
  scope_cut: "范围裁剪",
  scope_gate: "范围确认（审批）",
  solution_gate: "方案确认（审批）",
  solutions_fill: "补全候选方案",
  summarize: "汇总",
  synthesize: "综合分析",
  target_gate: "目标确认（审批）",
  track: "跟踪进展",
  validate: "验证",
};

/** 阶段显示名：运行时的人话 title → copy 表 → 「步骤 N」。 */
export function stageDisplayName(stageId: string, title: string, index: number): string {
  // 运行时给的是人话标题（定义里写了中文名）时优先用它；标题只是 id 本身时才查 copy 表。
  if (title && title !== stageId && !/^[a-z0-9_.-]+$/i.test(title)) return title;
  return STAGES[stageId] ?? `步骤 ${index + 1}`;
}

/**
 * 阶段产出显示名：运行时对内置工作流产出只给技术标签 `W029/intake`，不上屏——
 * 换成「<阶段名>的产出」；运行时给的是人话标签时原样用。
 */
export function outputDisplayLabel(label: string, stageName: string): string {
  if (/^[a-z]+\d+\/[a-z0-9_.-]+$/i.test(label.trim()) || /^[a-z0-9_.-]+$/i.test(label.trim())) return `「${stageName}」的产出`;
  return label;
}

/**
 * 审批门的人话标题：`<阶段显示名>` · `<工作流中文名>`。
 * 运行时的 summary 对内置工作流只是阶段 id（或 `target_gate（problem-to-prd@1）` 这类拼接），不直接上屏。
 */
export function gateDisplayTitle(gate: { stageId: string; summary: string }, workflowKey?: string): { stage: string; workflow: string | null } {
  const summary = gate.summary.trim();
  const looksTechnical = summary === gate.stageId || /^[a-z0-9_.-]+(（.*）|\(.*\))?$/i.test(summary);
  const stage = looksTechnical ? STAGES[gate.stageId] ?? "审批事项" : summary;
  return { stage, workflow: workflowKey ? workflowDisplayName(workflowKey) : null };
}
