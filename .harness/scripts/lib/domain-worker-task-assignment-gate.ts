/**
 * domain-worker-task-assignment-gate.ts —— PROP-HARNESS-AGENT-001 H3A-032
 * （Epic E3）："Domain→Worker Task Assignment gate | 030 | 不越领域、不越
 * 配额、不越权限"。
 *
 * 建在两条已落地的东西之上，故意不重复造轮子：
 *   - H3A-030 `.harness/scripts/lib/task-assignment-model.ts` 的 TPL-TSK-001
 *     单表 schema（`TaskAssignment`/`TaskBudget`）。
 *   - H3A-020/023/024 `.harness/scripts/lib/role-authorization.ts` 的
 *     `KIND_TO_LAYER` layer 派生、`LayeredRole`（areas/mergeAuthority/
 *     dispatchAuthority 都是它已经从既有字段派生好的规范视图）。
 *
 * 范围边界（跟 H3A-031 的分工）：这个模块只处理 assigned_by 解析出来
 * 是 layer:domain_orchestrator 的 Task Assignment——Root Orchestrator 直派
 * （layer:root_orchestrator）的校验是 H3A-031（Root→Domain gate，今天
 * `⬜ 未开始`）的事，本模块对那类 assignment 一律跳过，不越界替它下判断。
 * assigned_by 解析不到任何已知身份时同样跳过（既不能证明它是 Domain
 * Orchestrator，也不能证明它不是——按 H3A-031 尚未建成的现实，宁可跳过
 * 也不要对不确定的输入下 FAIL/WARN，那会是伪造判定）。
 *
 * 身份解析的口径（读文件前先想清楚，不然会踩两个坑）：
 *   1. Proposal §10.3 原文 `assigned_by: <directory-main-agent-id>`——字面
 *      意思是运行时 Directory ULID，不是稳定角色名。但今天全仓没有任何
 *      "Directory ULID → 稳定角色名"的静态映射表可查（§10.2 TPL-AGT-001
 *      运行实例登记表也是 0 实例），本模块和仓库里其余所有跨表 gate
 *      （H3A-022 domain owner、H3A-025 authority monotonicity）一样，
 *      按"字段值 = 已登记身份名"解析——即 `assigned_by`/`assignee_role`
 *      都当成 `.harness/agents/roles/*.yaml` 的 `name` 或
 *      `.harness/agents/registry.yaml` 的 `id` 来查。这是本模块唯一能
 *      核实的口径，如实标注：如果未来真的传入 Directory ULID 而非稳定
 *      角色名，本模块会把它当"未知身份"处理（见下方 UNKNOWN 分支），
 *      不会误判，但也验证不到"这个 ULID 当时确实持有哪个角色"这层运行态
 *      语义——那是 H3A-041 dispatch 协议该管的事。
 *   2. `areas` 的"落在范围内"取**子集**语义：worker 的每一个 area 都必须
 *      出现在 Domain Orchestrator 的 areas 里，而不是"有交集就算"——
 *      "不越领域"字面意思是 worker 不能声称覆盖 Domain 授权范围之外的
 *      任何一个 area，允许 worker 是 Domain 的子集专精（覆盖更少 area），
 *      不允许覆盖更多。
 *
 * budget 配额 gate（第 2 条"不越配额"）刻意选 WARN 而不是 FAIL：
 * `TaskBudget` schema（H3A-030）没有"例外理由"字段，本模块也不新增
 * 一个字段去凑——那会制造第二个"budget 例外"事实源。今天能核实的只是
 * "budget 数值本身是否符合 §10.3 原文默认约定"，符不符合默认值不足以
 * 断定"违规"（Root Orchestrator 可能真的判断需要真实并行而显式提高配额，
 * 原文允许这种情况存在），所以严重度选 WARN，如实在 doctor 输出里说明
 * "今天没有例外理由字段，无法区分合理例外与违规"这层做不到的判断。
 * `max_total_worker_runs < max_parallel_workers` 则是纯粹的结构不自洽
 * （总运行次数上限比同时并行数还小，数学上不可能满足），跟"默认值是不是
 * 1/2"无关，判 FAIL。
 *
 * 校验风格延续 domain-skill-gates.ts/domain-orchestrator-binding.ts 的
 * 先例：手写纯函数，累积上报全部问题，不 fail-fast；IO 在
 * task-assignment-doctor.ts。
 */
import type { TaskAssignment } from "./task-assignment-model";
import type { LayeredRole } from "./role-authorization";

export type GateSeverity = "FAIL" | "WARN";

export interface GateFinding {
  code: string;
  severity: GateSeverity;
  sourceFile: string;
  message: string;
}

/**
 * Proposal §10.3 原文默认约定："默认只有一个并行实现 Worker，并为独立
 * Verifier 预留第二个运行实例"——即默认 `max_parallel_workers: 1`。
 * 超过这个默认值不是自动违规（原文允许 Root Orchestrator 显式提高），
 * 但今天没有例外理由字段可核实"是不是真的显式决定"，所以给一个比默认值
 * 宽松、但仍然是天花板的阈值：等于默认值 1 时不提示；大于 1 时 WARN。
 */
const DEFAULT_MAX_PARALLEL_WORKERS = 1;

/** 按名字在已知角色集合里查身份——见文件头注释①的口径说明。 */
function resolveRole(name: string, rolesByName: ReadonlyMap<string, LayeredRole>): LayeredRole | undefined {
  return rolesByName.get(name);
}

/* ═══════════════════════ H3A-032a：不越领域 ═══════════════════════ */

/**
 * @param assignments 已通过 H3A-030 schema 校验的 Task Assignment 实例。
 * @param rolesByName 已知身份名 → LayeredRole（H3A-020 校验通过的角色文件 +
 *   registry.yaml agents[] 的 kind 派生，同 role-authorization-doctor.ts
 *   H3A-022 那段"两个来源取并集"的口径——见 role-authorization-doctor.ts
 *   的 orchestratorNames 构造方式）。
 */
export function checkDomainScope(
  assignments: readonly TaskAssignment[],
  rolesByName: ReadonlyMap<string, LayeredRole>,
): GateFinding[] {
  const findings: GateFinding[] = [];

  for (const assignment of assignments) {
    const assignedBy = resolveRole(assignment.assigned_by, rolesByName);
    if (!assignedBy || assignedBy.layer !== "domain_orchestrator") {
      // 不是本模块的范围：assigned_by 是 root（H3A-031 的事）或未知身份
      // （既不能证明是也不能证明不是 Domain Orchestrator，跳过而不是伪造判定）。
      continue;
    }

    const assignee = resolveRole(assignment.assignee_role, rolesByName);
    if (!assignee) {
      findings.push({
        code: "H3A032-ASSIGNEE-UNKNOWN-IDENTITY",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}" 的 assignee_role "${assignment.assignee_role}" ` +
          `在已知身份（角色文件 + registry.yaml）里找不到——Domain Orchestrator 不能把任务派给一个无法核实身份的对象`,
      });
      continue;
    }

    if (assignee.layer !== "specialist_worker") {
      findings.push({
        code: "H3A032-ASSIGNEE-NOT-WORKER",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：assigned_by "${assignment.assigned_by}" 是 ` +
          `layer:domain_orchestrator，但 assignee_role "${assignment.assignee_role}" 的 layer 是 ` +
          `"${assignee.layer}"，不是 specialist_worker——Domain Orchestrator 只能把任务派给 Specialist Worker`,
      });
      continue;
    }

    const outOfScopeAreas = assignee.areas.filter((a) => !assignedBy.areas.includes(a));
    if (outOfScopeAreas.length > 0) {
      findings.push({
        code: "H3A032-AREA-OUT-OF-DOMAIN",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：assignee_role "${assignment.assignee_role}" 的 areas ` +
          `[${outOfScopeAreas.join(", ")}] 不在 assigned_by "${assignment.assigned_by}" 的 Domain areas ` +
          `[${assignedBy.areas.join(", ")}] 范围内——不越领域要求 worker 的 area 是 Domain 的子集`,
      });
    }
  }

  return findings;
}

/* ═══════════════════════ H3A-032b：不越配额 ═══════════════════════ */

export function checkWorkerBudgetQuota(assignments: readonly TaskAssignment[]): GateFinding[] {
  const findings: GateFinding[] = [];

  for (const assignment of assignments) {
    const { max_parallel_workers, max_total_worker_runs } = assignment.budget;

    if (max_total_worker_runs < max_parallel_workers) {
      findings.push({
        code: "H3A032-BUDGET-RUNS-BELOW-PARALLEL",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：budget.max_total_worker_runs ` +
          `(${max_total_worker_runs}) 小于 budget.max_parallel_workers (${max_parallel_workers})——` +
          `总运行次数上限不可能小于同时并行数，结构不自洽`,
      });
    }

    if (max_parallel_workers > DEFAULT_MAX_PARALLEL_WORKERS) {
      findings.push({
        code: "H3A032-PARALLEL-WORKERS-ABOVE-DEFAULT",
        severity: "WARN",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：budget.max_parallel_workers ` +
          `(${max_parallel_workers}) 超过 §10.3 原文默认约定（默认 1 个并行实现 Worker，` +
          `Verifier 预留第二个运行实例但不计入并行度）——若这是 Root Orchestrator 因真实并行/` +
          `上下文隔离/专业化需求显式提高的配额，属于原文允许的例外；但 schema 今天没有例外理由` +
          `字段，本检查无法区分"合理例外"与"违规"，只能如实标注为 WARN 保持可见`,
      });
    }
  }

  return findings;
}

/* ═══════════════════════ H3A-032c：不越权限 ═══════════════════════ */

/**
 * 跟 role-authorization.ts 的 `checkAuthorityMonotonicity` 比较模式一致
 * （子角色权限不能大于上级），但数据来源不同：那条比的是角色文件的
 * `reports_to` 静态关系；这条比的是 Task Assignment 实例里
 * `assigned_by`→`assignee_role` 的派工关系。两者不能混为一谈——同一个
 * worker 的 `reports_to` 可能指向别的 supervisor，但某次具体派工的
 * `assigned_by` 是另一个 Domain Orchestrator，这条 gate 只管这次派工
 * 本身有没有越权，不重新验证组织关系（那是 H3A-025 的事）。
 */
export function checkAssigneeAuthorityCeiling(
  assignments: readonly TaskAssignment[],
  rolesByName: ReadonlyMap<string, LayeredRole>,
): GateFinding[] {
  const findings: GateFinding[] = [];

  for (const assignment of assignments) {
    const assignedBy = resolveRole(assignment.assigned_by, rolesByName);
    if (!assignedBy || assignedBy.layer !== "domain_orchestrator") continue; // 见 H3A-032a 同样的范围边界

    const assignee = resolveRole(assignment.assignee_role, rolesByName);
    if (!assignee) continue; // 已由 H3A032-ASSIGNEE-UNKNOWN-IDENTITY 报过，这里不重复报

    if (assignee.mergeAuthority && !assignedBy.mergeAuthority) {
      findings.push({
        code: "H3A032-AUTHORITY-EXCEEDS-ASSIGNER",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：assignee_role "${assignment.assignee_role}" 的 ` +
          `merge_authority:true，但 assigned_by "${assignment.assigned_by}" 是 false——` +
          `被派工者的权限不能超过派工者`,
      });
    }
    if (assignee.dispatchAuthority && !assignedBy.dispatchAuthority) {
      findings.push({
        code: "H3A032-AUTHORITY-EXCEEDS-ASSIGNER",
        severity: "FAIL",
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"：assignee_role "${assignment.assignee_role}" 的 ` +
          `dispatch_authority:true，但 assigned_by "${assignment.assigned_by}" 是 false——` +
          `被派工者的权限不能超过派工者`,
      });
    }
  }

  return findings;
}
