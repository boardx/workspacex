/**
 * task-assignment-model.ts —— PROP-HARNESS-AGENT-001 H3A-030（Epic E3 的根，
 * 031/032/038 都直接依赖它，033 起的 Workflow Event 链间接依赖它）。
 *
 * 完成契约原文："objective/scope/acceptance/budget/authority hash 完整"。
 * 形状取自 Proposal §10.3 的示例（PROP-HARNESS-AGENT-001.md:602-627）：
 *
 *   template_id: TPL-TSK-001
 *   template_version: 1
 *   instance_id: TSK-658-canvas-01
 *   parent_task_id: TSK-658-main
 *   assigned_by: <directory-main-agent-id>
 *   assignee_role: coord-canvas
 *   objective: 建立 Mermaid 到 Fabric 对象的稳定身份映射
 *   scope: { include: [], exclude: [] }
 *   dependencies: []
 *   acceptance_refs: []
 *   skill_refs: [SKL-MOD-CANVAS-001]
 *   budget: { max_parallel_workers: 1, max_total_worker_runs: 2, max_retries: 1,
 *             token: null, cost: null, wall_time_ms: null }
 *   authority_snapshot_hash: <authorization-model-hash>
 *
 * 范围边界（跟其余 H3A-03x 条目的分工，避免这个文件越界做别人的事）：
 *   - 本条目只管**单表结构完整性**——字段存在、类型正确、budget 数值合理。
 *   - "assignee_role 是否真实存在于 role-authorization.ts 的 layer 体系里、
 *     scope 有没有越权、dependencies 指向的 task 是否真实存在" 是跨表检查，
 *     属于 H3A-031（Root→Domain gate）/H3A-032（Domain→Worker gate），
 *     故意不在这里做——同 domain-skill-model.ts 单表 schema 和
 *     domain-skill-gates.ts 跨表 gate 拆开的先例。
 *   - `authority_snapshot_hash` 本条目只检查"非空字符串存在"（完成契约的
 *     "authority hash 完整"字面意思），不校验这个 hash 是否真的等于当前
 *     Authorization Model 的哈希——那需要真实计算 role-authorization.ts
 *     校验结果的哈希并比对，是运行态语义，不是 schema 结构检查，如实留给
 *     使用这个 schema 的调用方（未来的 dispatch 协议 H3A-041）处理。
 *
 * 今天没有任何真实 TPL-TSK-001 实例——Epic E3 之前完全未开工，这不是本条目
 * 的问题，是仓库的真实状态（同 H3A-012 Domain Skill schema 落地时 0 个真实
 * 实例的先例）。本文件也不新造一个"实例存放目录"的既成事实——Proposal 没
 * 规定 Task Assignment 实例落在哪（可能是文件、可能是 GitHub issue 评论，
 * 见 H3A-039"GitHub 评论结构化投影"），编一个目录扫描出来会让"今天没有实例"
 * 这件事被误读成"已经建好了存放约定"，这不是本条目该做的判断。
 *
 * 校验风格延续 domain-model.ts/domain-skill-model.ts/role-authorization.ts
 * 的先例：plain TS interface + 手写校验函数，累积上报全部问题，不 fail-fast。
 */

export const TASK_ASSIGNMENT_TEMPLATE_ID = "TPL-TSK-001" as const;

export interface TaskScope {
  include: string[];
  exclude: string[];
}

export interface TaskBudget {
  max_parallel_workers: number;
  max_total_worker_runs: number;
  max_retries: number;
  /** null = 未设置上限（Proposal 示例本身就把这三项写成 null）。 */
  token: number | null;
  cost: number | null;
  wall_time_ms: number | null;
}

export interface TaskAssignment {
  template_id: typeof TASK_ASSIGNMENT_TEMPLATE_ID;
  template_version: number;
  instance_id: string;
  /** null = 根任务，没有父任务。 */
  parent_task_id: string | null;
  assigned_by: string;
  assignee_role: string;
  objective: string;
  scope: TaskScope;
  dependencies: string[];
  acceptance_refs: string[];
  skill_refs: string[];
  budget: TaskBudget;
  authority_snapshot_hash: string;
  /** 扫描时附加的定位信息，不是文档自身字段。 */
  sourceFile: string;
}

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

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isNullOrNonNegativeNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

function validateScope(raw: unknown, sourceFile: string): ValidationResult<TaskScope> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#scope.${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#scope`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!isStringArray(r.include)) issues.push({ path: p("include"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  if (!isStringArray(r.exclude)) issues.push({ path: p("exclude"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { include: r.include as string[], exclude: r.exclude as string[] }, issues: [] };
}

function validateBudget(raw: unknown, sourceFile: string): ValidationResult<TaskBudget> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#budget.${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#budget`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  // §10.3 原文："默认只有一个并行实现 Worker，并为独立 Verifier 预留第二个运行实例"
  // ——这句是 H3A-042（Domain Worker quota）的判定逻辑，不是本条目的事；本条目
  // 只检查这三个字段是"合理的非负整数"，不检查是否等于 1/2 这个默认值。
  if (!isNonNegativeInt(r.max_parallel_workers) || (r.max_parallel_workers as number) < 1) {
    issues.push({ path: p("max_parallel_workers"), message: "必须是 ≥1 的整数" });
  }
  if (!isNonNegativeInt(r.max_total_worker_runs) || (r.max_total_worker_runs as number) < 1) {
    issues.push({ path: p("max_total_worker_runs"), message: "必须是 ≥1 的整数" });
  }
  if (!isNonNegativeInt(r.max_retries)) {
    issues.push({ path: p("max_retries"), message: "必须是 ≥0 的整数" });
  }
  if (!isNullOrNonNegativeNumber(r.token)) issues.push({ path: p("token"), message: "必须是 null 或 ≥0 的数字" });
  if (!isNullOrNonNegativeNumber(r.cost)) issues.push({ path: p("cost"), message: "必须是 null 或 ≥0 的数字" });
  if (!isNullOrNonNegativeNumber(r.wall_time_ms)) issues.push({ path: p("wall_time_ms"), message: "必须是 null 或 ≥0 的数字" });

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      max_parallel_workers: r.max_parallel_workers as number,
      max_total_worker_runs: r.max_total_worker_runs as number,
      max_retries: r.max_retries as number,
      token: r.token as number | null,
      cost: r.cost as number | null,
      wall_time_ms: r.wall_time_ms as number | null,
    },
    issues: [],
  };
}

/**
 * 校验一份已解析的 YAML 是否是合法的 TPL-TSK-001 Task Assignment 实例。
 * 调用方负责先判断"这份 YAML 看起来像不像 Task Assignment"（同
 * domain-skill-model.ts 的 looksLikeDomainSkillInstance 先例）。
 */
export function validateTaskAssignment(raw: unknown, sourceFile: string): ValidationResult<TaskAssignment> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: sourceFile, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (r.template_id !== TASK_ASSIGNMENT_TEMPLATE_ID) {
    issues.push({ path: p("template_id"), message: `必须等于 "${TASK_ASSIGNMENT_TEMPLATE_ID}"，实得 ${JSON.stringify(r.template_id)}` });
  }
  if (typeof r.template_version !== "number" || !Number.isInteger(r.template_version) || r.template_version < 1) {
    issues.push({ path: p("template_version"), message: `必须是 ≥1 的整数，实得 ${JSON.stringify(r.template_version)}` });
  }
  if (!isNonEmptyString(r.instance_id)) issues.push({ path: p("instance_id"), message: "必须是非空字符串" });
  if (r.parent_task_id !== null && !isNonEmptyString(r.parent_task_id)) {
    issues.push({ path: p("parent_task_id"), message: "必须是非空字符串或 null（null = 根任务，没有父任务）" });
  }
  if (!isNonEmptyString(r.assigned_by)) issues.push({ path: p("assigned_by"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.assignee_role)) issues.push({ path: p("assignee_role"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.objective)) issues.push({ path: p("objective"), message: "必须是非空字符串——完成契约要求 objective 完整" });
  if (!isStringArray(r.dependencies)) issues.push({ path: p("dependencies"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  if (!isStringArray(r.acceptance_refs) || r.acceptance_refs.length === 0) {
    issues.push({ path: p("acceptance_refs"), message: "必须是至少含 1 个元素的字符串数组——完成契约要求 acceptance 完整，空验收标准不算完整" });
  }
  if (!isStringArray(r.skill_refs)) issues.push({ path: p("skill_refs"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  if (!isNonEmptyString(r.authority_snapshot_hash)) {
    issues.push({ path: p("authority_snapshot_hash"), message: "必须是非空字符串——完成契约要求 authority hash 完整" });
  }

  const scopeResult = validateScope(r.scope, sourceFile);
  issues.push(...scopeResult.issues);
  const budgetResult = validateBudget(r.budget, sourceFile);
  issues.push(...budgetResult.issues);

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      template_id: TASK_ASSIGNMENT_TEMPLATE_ID,
      template_version: r.template_version as number,
      instance_id: r.instance_id as string,
      parent_task_id: (r.parent_task_id as string | null) ?? null,
      assigned_by: r.assigned_by as string,
      assignee_role: r.assignee_role as string,
      objective: r.objective as string,
      scope: scopeResult.value!,
      dependencies: r.dependencies as string[],
      acceptance_refs: r.acceptance_refs as string[],
      skill_refs: r.skill_refs as string[],
      budget: budgetResult.value!,
      authority_snapshot_hash: r.authority_snapshot_hash as string,
      sourceFile,
    },
    issues: [],
  };
}

/** 判断一份已解析的 YAML 是否"看起来像" TPL-TSK-001 实例。 */
export function looksLikeTaskAssignment(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return (parsed as Record<string, unknown>).template_id === TASK_ASSIGNMENT_TEMPLATE_ID;
}
