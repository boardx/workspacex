/**
 * workflow-event-model.ts —— PROP-HARNESS-AGENT-001 H3A-033（Epic E3，依赖
 * H3A-030 的 TPL-TSK-001，见 task-assignment-model.ts）。
 *
 * 完成契约原文："Task Assignment/Progress/Blocker/Task Result 可解析"。
 *
 * Proposal §10.4（PROP-HARNESS-AGENT-001.md:641-658）只给出 `kind: progress`
 * 一种完整示例形状：
 *
 *   template_id: TPL-EVT-001
 *   template_version: 1
 *   instance_id: EVT-658-0007
 *   kind: progress
 *   task_id: TSK-658-canvas-01
 *   actor: <directory-agent-id>
 *   head_sha: <exact-sha>
 *   delta:
 *     implemented: []
 *   blockers: []
 *   evidence_refs: []
 *   next_action:
 *     owner_role: canvas-verifier
 *     action: verify_exact_sha
 *
 * 四类 kind 的出处是 Proposal line 205："普通协作只允许 Task Assignment、
 * Progress、Blocker/DecisionRequest、Task Result/Review Decision 四类
 * Workflow Event。" 以及 line 752-754 的角色表（Progress: 下级→上级/总线，
 * 只报告新增事实和证据；Blocker/DecisionRequest: 下级→授权层，请求范围外
 * 决策；Task Result/Review Decision: Producer/Verifier→上级，exact revision
 * 的产出与审查决定）。
 *
 * ⚠ 诚实标注：Proposal 全文没有给出 `task_assignment`/`blocker`/`task_result`
 * 三种 kind 各自的字段清单——只有 `progress` 有逐字示例。下面这三类的
 * kind 专属字段是**从 Proposal 上下文合理推断，不是原文逐字规定**：
 *   - `task_assignment`：这个 kind 表达的是"一次 Task Assignment 的下发/
 *     确认事件"，不是 TPL-TSK-001 本身（那是另一个模板，见
 *     task-assignment-model.ts）。最小必要字段推断为 `assignment_ref`——
 *     指向被下发/确认的 TPL-TSK-001 `instance_id`，否则这条事件就没有
 *     "这是关于哪次任务下发"的锚点，光有公共骨架的 `task_id` 不够（`task_id`
 *     锚定的是任务本身，`assignment_ref` 锚定的是这次具体的下发/确认动作）。
 *   - `blocker`：line 753 "请求范围外决策"——最小必要字段推断为
 *     `blocked_reason`（非空字符串，说明被什么挡住）+ `next_action`（复用
 *     progress 已有的 `{owner_role, action}` 结构，因为 blocker 天然需要
 *     "谁来做这个范围外决策"的路由目标，同 progress 的 next_action 语义
 *     一致，不是另造一个新结构）。
 *   - `task_result`：line 754 "exact revision 的产出与审查决定"——这里的
 *     "审查决定"部分已经由 TPL-RVW-001（H3A-036，Review Decision）单独建模，
 *     `task_result` 这个 kind 只负责"产出"部分，最小必要字段推断为
 *     `result_summary`（非空字符串，陈述产出了什么）。同 §10.5 原文提醒
 *     "Task Result 只陈述产物和执行结果，不能隐含 APPROVE"——这正是本条目
 *     刻意不把 decision/approve 语义塞进 task_result 的原因。
 * 如果后续发现这三类的字段跟 Proposal 原文（或补充的 ADR）冲突，以原文为准，
 * 本文件的推断让路。
 *
 * 范围边界（同 H3A-030 的先例，避免越界做别人的事）：
 *   - 本条目只做**单份 envelope 的结构完整性**——kind 枚举合法、该 kind
 *     必须字段存在、类型正确。
 *   - "Event stable ID 与 append-only"（不能有重复 ID、不能覆写历史）是
 *     H3A-034，故意不在这里做——那是跨实例的关系约束，不是单份结构校验。
 *   - "12 行短文本 renderer"是 H3A-035，故意不在这里做——那是渲染逻辑，
 *     不是校验逻辑。
 *   - 不管这些实例之间的关系（比如 `task_id` 指向的 Task Assignment 是否
 *     真实存在）——那需要跨表查找，不是单份 YAML 的结构校验。
 *
 * 今天没有任何真实 TPL-EVT-001 实例——Epic E3 才刚起步（H3A-030 是第一个
 * 落地的条目），这是仓库的真实状态，不是本条目的 bug（同
 * task-assignment-model.ts 落地时 0 个真实实例的先例）。
 *
 * 校验风格延续 task-assignment-model.ts/domain-skill-model.ts 的先例：
 * plain TS interface + 手写校验函数，累积上报全部问题，不 fail-fast。
 */

export const WORKFLOW_EVENT_TEMPLATE_ID = "TPL-EVT-001" as const;

export const WORKFLOW_EVENT_KINDS = ["task_assignment", "progress", "blocker", "task_result"] as const;
export type WorkflowEventKind = (typeof WORKFLOW_EVENT_KINDS)[number];

export interface WorkflowEventNextAction {
  owner_role: string;
  action: string;
}

export interface WorkflowEventDelta {
  implemented: string[];
}

/** 公共 envelope 字段，四类 kind 共有。 */
interface WorkflowEventEnvelopeBase {
  template_id: typeof WORKFLOW_EVENT_TEMPLATE_ID;
  template_version: number;
  instance_id: string;
  task_id: string;
  actor: string;
  head_sha: string;
  evidence_refs: string[];
  /** 扫描时附加的定位信息，不是文档自身字段。 */
  sourceFile: string;
}

export interface TaskAssignmentWorkflowEvent extends WorkflowEventEnvelopeBase {
  kind: "task_assignment";
  /** §10.4 未直接给出此 kind 的字段清单——见文件头部注释的推断说明。 */
  assignment_ref: string;
}

export interface ProgressWorkflowEvent extends WorkflowEventEnvelopeBase {
  kind: "progress";
  /** §10.4 示例原文字段。 */
  delta: WorkflowEventDelta;
  blockers: string[];
  next_action: WorkflowEventNextAction;
}

export interface BlockerWorkflowEvent extends WorkflowEventEnvelopeBase {
  kind: "blocker";
  /** §10.4 未直接给出此 kind 的字段清单——见文件头部注释的推断说明。 */
  blocked_reason: string;
  next_action: WorkflowEventNextAction;
}

export interface TaskResultWorkflowEvent extends WorkflowEventEnvelopeBase {
  kind: "task_result";
  /** §10.4 未直接给出此 kind 的字段清单——见文件头部注释的推断说明。 */
  result_summary: string;
}

export type WorkflowEvent = TaskAssignmentWorkflowEvent | ProgressWorkflowEvent | BlockerWorkflowEvent | TaskResultWorkflowEvent;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  issues: ValidationIssue[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateNextAction(raw: unknown, sourceFile: string, field: string): ValidationResult<WorkflowEventNextAction> {
  const issues: ValidationIssue[] = [];
  const p = (sub: string) => `${sourceFile}#${field}.${sub}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#${field}`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.owner_role)) issues.push({ path: p("owner_role"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.action)) issues.push({ path: p("action"), message: "必须是非空字符串" });
  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { owner_role: r.owner_role as string, action: r.action as string }, issues: [] };
}

function validateDelta(raw: unknown, sourceFile: string): ValidationResult<WorkflowEventDelta> {
  const issues: ValidationIssue[] = [];
  const p = (sub: string) => `${sourceFile}#delta.${sub}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#delta`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!isStringArray(r.implemented)) {
    issues.push({ path: p("implemented"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  }
  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { implemented: r.implemented as string[] }, issues: [] };
}

/** 校验四类 kind 共有的 envelope 字段。调用方负责再校验 kind 专属字段。 */
function validateEnvelopeBase(r: Record<string, unknown>, sourceFile: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#${field}`;

  if (r.template_id !== WORKFLOW_EVENT_TEMPLATE_ID) {
    issues.push({ path: p("template_id"), message: `必须等于 "${WORKFLOW_EVENT_TEMPLATE_ID}"，实得 ${JSON.stringify(r.template_id)}` });
  }
  if (typeof r.template_version !== "number" || !Number.isInteger(r.template_version) || r.template_version < 1) {
    issues.push({ path: p("template_version"), message: `必须是 ≥1 的整数，实得 ${JSON.stringify(r.template_version)}` });
  }
  if (!isNonEmptyString(r.instance_id)) issues.push({ path: p("instance_id"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.task_id)) issues.push({ path: p("task_id"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.actor)) issues.push({ path: p("actor"), message: "必须是非空字符串——Directory ULID，不是稳定角色名（Proposal §10.2 原文）" });
  if (!isNonEmptyString(r.head_sha)) issues.push({ path: p("head_sha"), message: "必须是非空字符串——exact SHA（Proposal §10.4 原文）" });
  if (!isStringArray(r.evidence_refs)) issues.push({ path: p("evidence_refs"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });

  return issues;
}

/**
 * 校验一份已解析的 YAML 是否是合法的 TPL-EVT-001 Workflow Event 实例。
 * 调用方负责先判断"这份 YAML 看起来像不像 Workflow Event"（同
 * task-assignment-model.ts 的 looksLikeTaskAssignment 先例）。
 */
export function validateWorkflowEvent(raw: unknown, sourceFile: string): ValidationResult<WorkflowEvent> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: sourceFile, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  const issues = validateEnvelopeBase(r, sourceFile);

  const kind = r.kind;
  if (!WORKFLOW_EVENT_KINDS.includes(kind as WorkflowEventKind)) {
    issues.push({
      path: `${sourceFile}#kind`,
      message: `必须是 ${WORKFLOW_EVENT_KINDS.map((k) => `"${k}"`).join(" | ")} 之一，实得 ${JSON.stringify(kind)}`,
    });
    // kind 不合法就没法继续校验 kind 专属字段了，直接汇总已知问题返回。
    return { ok: false, value: null, issues };
  }

  const base = {
    template_id: WORKFLOW_EVENT_TEMPLATE_ID,
    template_version: r.template_version as number,
    instance_id: r.instance_id as string,
    task_id: r.task_id as string,
    actor: r.actor as string,
    head_sha: r.head_sha as string,
    evidence_refs: r.evidence_refs as string[],
    sourceFile,
  };

  if (kind === "progress") {
    const deltaResult = validateDelta(r.delta, sourceFile);
    issues.push(...deltaResult.issues);
    if (!isStringArray(r.blockers)) {
      issues.push({ path: `${sourceFile}#blockers`, message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
    }
    const nextActionResult = validateNextAction(r.next_action, sourceFile, "next_action");
    issues.push(...nextActionResult.issues);
    if (issues.length > 0) return { ok: false, value: null, issues };
    return {
      ok: true,
      value: { ...base, kind: "progress", delta: deltaResult.value!, blockers: r.blockers as string[], next_action: nextActionResult.value! },
      issues: [],
    };
  }

  if (kind === "task_assignment") {
    if (!isNonEmptyString(r.assignment_ref)) {
      issues.push({ path: `${sourceFile}#assignment_ref`, message: "必须是非空字符串——指向被下发/确认的 TPL-TSK-001 instance_id" });
    }
    if (issues.length > 0) return { ok: false, value: null, issues };
    return { ok: true, value: { ...base, kind: "task_assignment", assignment_ref: r.assignment_ref as string }, issues: [] };
  }

  if (kind === "blocker") {
    if (!isNonEmptyString(r.blocked_reason)) {
      issues.push({ path: `${sourceFile}#blocked_reason`, message: "必须是非空字符串——说明被什么挡住" });
    }
    const nextActionResult = validateNextAction(r.next_action, sourceFile, "next_action");
    issues.push(...nextActionResult.issues);
    if (issues.length > 0) return { ok: false, value: null, issues };
    return {
      ok: true,
      value: { ...base, kind: "blocker", blocked_reason: r.blocked_reason as string, next_action: nextActionResult.value! },
      issues: [],
    };
  }

  // kind === "task_result"
  if (!isNonEmptyString(r.result_summary)) {
    issues.push({ path: `${sourceFile}#result_summary`, message: "必须是非空字符串——陈述产出了什么（不能隐含 APPROVE，Proposal §10.5 原文）" });
  }
  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { ...base, kind: "task_result", result_summary: r.result_summary as string }, issues: [] };
}

/** 判断一份已解析的 YAML 是否"看起来像" TPL-EVT-001 实例。 */
export function looksLikeWorkflowEvent(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return (parsed as Record<string, unknown>).template_id === WORKFLOW_EVENT_TEMPLATE_ID;
}
