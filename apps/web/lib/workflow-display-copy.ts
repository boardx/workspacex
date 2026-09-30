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
  { workflowId: "W001", key: "research-to-brief", name: "研究到简报" },
  { workflowId: "W002", key: "meeting-to-actions", name: "会议纪要转行动项" },
  { workflowId: "W027", key: "discovery-to-opportunity", name: "探索发现到机会评估" },
  { workflowId: "W028", key: "research-to-insight", name: "用户研究到洞察" },
  { workflowId: "W029", key: "problem-to-prd", name: "问题定义到 PRD" },
  { workflowId: "W030", key: "prd-to-sprint", name: "PRD 到迭代计划" },
  { workflowId: "W031", key: "experiment-loop", name: "实验闭环" },
  { workflowId: "W032", key: "roadmap-review", name: "路线图评审" },
  // 批次 2（key 与 `BATCH2_WORKFLOW_SLOTS` 逐项核对；Definition 见 API definitions/{shared,operations}）。
  { workflowId: "W003", key: "decision-to-execution", name: "决策到执行" },
  { workflowId: "W004", key: "weekly-executive-digest", name: "高管周报" },
  { workflowId: "W007", key: "issue-to-resolution", name: "问题到解决" },
  { workflowId: "W052", key: "request-to-project", name: "请求到项目" },
  { workflowId: "W053", key: "weekly-pmo-review", name: "PMO 周度复核" },
  { workflowId: "W055", key: "process-improvement", name: "流程改进" },
  { workflowId: "W056", key: "incident-to-postmortem", name: "事件到复盘" },
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

const RUN_TITLE_ID = /^\s*(W\d{3})\b\s*([^·:：]*?)\s*(?=[·:：]|$)/i;

/** 运行卡标题：`W029 Problem-to-PRD · xxx` → `问题定义到 PRD · xxx`；开头不是内置编号时原样返回。 */
export function runTitleDisplay(title: string): string {
  const m = RUN_TITLE_ID.exec(title);
  if (!m) return title;
  const name = findBuiltinWorkflow(m[1]!)?.name;
  if (!name) return title;
  const rest = title.slice(m[0].length).trim();
  return rest ? `${name} ${rest}` : name;
}

const STAGES: Record<string, string> = {
  accept: "受理确认（审批）",
  action_check: "核对行动项状态",
  activation_define: "定义激活指标",
  adjudicate: "裁决分歧",
  analyze: "分析数据",
  apply: "应用变更",
  apply_board: "看板整理确认（审批）",
  apply_triage: "回写分诊结果",
  approve_actions: "审批行动项",
  approve_baseline: "基线确认（审批）",
  approve_cards: "建卡确认（审批）",
  approve_plan: "方案确认（审批）",
  approve_reply: "回复确认（审批）",
  approve_sop: "SOP 草稿确认（审批）",
  assemble: "汇成复核包",
  audit: "审计核查",
  baseline_report: "行动项基线报告",
  brief: "决策简报",
  capacity: "容量核对",
  capture: "知识捕获",
  change_decisions: "变更决定（审批）",
  changes: "变更请求复核",
  charter: "项目章程",
  clarify: "向请求人澄清",
  collect: "收集材料",
  commit_gate: "承诺确认（审批）",
  commit_proposal: "提交方案",
  competition: "竞品分析",
  compose: "撰写周报",
  confirm_facts: "事实确认（审批）",
  confirm_triage: "分诊确认（审批）",
  coverage_check: "覆盖度检查",
  create_project: "创建项目",
  data_lock: "锁定数据",
  decide: "做出决策",
  decision_check: "核对决定是否仍有效",
  demand_check: "需求验证",
  design: "设计方案",
  diagnose: "问题诊断",
  document: "撰写复盘文档",
  draft: "起草文档",
  escalate_decide: "升级决定（审批）",
  escalate_draft: "起草升级简报",
  estimate: "工作量估算",
  estimation_gate: "估算确认（审批）",
  external_view: "外部视角",
  extract: "提取要点",
  fieldwork: "实地调研",
  followup_intake: "接收跟进请求",
  frame: "界定问题",
  frame_gate: "问题界定确认（审批）",
  gaps_gate: "缺口确认（审批）",
  gather: "汇集信息",
  handoff: "交接",
  health_check: "健康检查",
  hex: "六维评估",
  hygiene: "看板卫生检查",
  hypothesize: "提出假设",
  import_outline: "导入访谈提纲",
  intake: "接收需求",
  integrate: "整合结论",
  kb_draft: "起草知识库文章",
  kb_review: "知识库文章确认（审批）",
  kpi: "制定指标",
  kpi_bind: "绑定指标",
  launch_attest: "上线确认",
  map: "梳理机会",
  materialize_actions: "建行动项卡片",
  materialize_preview: "建卡预览",
  metric_audit: "指标核查",
  metrics: "设计指标",
  metrics_check: "复核指标",
  metrics_review: "审视指标集",
  notify: "发送通知",
  outcome_review: "结果复盘",
  persist: "保存产出文档",
  pilot_intake: "接收试点复盘请求",
  pilot_publish: "发布试点结论",
  plan: "制定计划",
  plan_gate: "计划确认（审批）",
  plan_interviews: "规划访谈",
  planning: "迭代规划",
  prd_gate: "PRD 确认（审批）",
  precheck: "前置检查",
  preregister: "实验预注册",
  preview: "建卡预览",
  prioritize: "排定优先级",
  publish: "发布",
  publish_mail: "邮件发布",
  publish_plan: "发布计划",
  publish_record: "发布记录",
  publish_report: "发布回报",
  readiness: "就绪检查",
  readout: "结果解读",
  recompute: "重新计算",
  reconcile: "核对对账",
  record: "记录",
  record_review: "记录复核",
  register_baseline: "登记基线",
  replan: "重新规划",
  reply_draft: "起草回复",
  report: "撰写回报",
  rerank: "重新排序",
  resolve: "解决确认（审批）",
  retention_followup: "留存跟进",
  review: "评审",
  review_assign: "复盘确认与认领（审批）",
  review_digest: "周报确认（审批）",
  review_insight: "复核洞察",
  review_pack: "复核包确认（审批）",
  review_plan: "复核计划",
  revise: "修订",
  risk: "风险评估",
  scope: "界定范围",
  scope_cut: "范围裁剪",
  scope_gate: "范围确认（审批）",
  screen: "对策筛选（审批）",
  send_reply: "发送回复",
  solution_gate: "方案确认（审批）",
  solutions_fill: "补全候选方案",
  sop: "起草 SOP",
  status: "汇总状态",
  summarize: "汇总",
  sweep: "扫描本周决策",
  synthesize: "综合分析",
  target_gate: "目标确认（审批）",
  timeline: "重建时间线",
  track: "跟踪进展",
  triage: "工单分诊",
  validate: "验证",
  validate_map: "流程图确认（审批）",
  write_cards: "写入看板卡片",
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
