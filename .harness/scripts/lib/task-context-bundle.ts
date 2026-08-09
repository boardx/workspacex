/**
 * task-context-bundle.ts —— PROP-HARNESS-AGENT-001 H3A-038（Epic E3，依赖
 * H3A-030 的 TaskAssignment，见 task-assignment-model.ts；依赖 H3A-033 的
 * WorkflowEvent 四类 kind，见 workflow-event-model.ts）。
 *
 * 完成契约原文（checklist line 86）："Task Context Bundle selector | 030、033 |
 * 不含 supervisor private reasoning 和无关日志"。
 *
 * Proposal §14「Task Context Bundle（原 Context Pack）」给出 YAML 示例：
 *
 *   task_ref: TSK-658-canvas-01
 *   role_ref: ROL-canvas-implementer
 *   domain_skill_ref: SKL-MOD-CANVAS-001
 *   spec_revision: <exact-sha>
 *   required_refs: { contracts: [], adrs: [], source_paths: [], evidence: [] }
 *   excluded_context:
 *     - parent_private_reasoning
 *     - unrelated_issue_history
 *     - sibling_raw_logs
 *
 * 紧接原文："Root Orchestrator 不加载所有 Domain Skill；Domain Orchestrator
 * 不加载其他领域完整知识；Specialist Worker 不继承 Root/Domain 的完整对话。"
 *
 * ⚠ 诚实标注 1——"排除 supervisor private reasoning" 今天做不到多少：
 * Proposal §14 示例把 `parent_private_reasoning` 列在 `excluded_context` 里，
 * 但那是**文档层面的意图声明**，不是字段规范——TaskAssignment
 * （task-assignment-model.ts）和 WorkflowEvent（workflow-event-model.ts）
 * 的 schema 里都没有任何字段标记"这段内容是 supervisor 的私有推理过程"。
 * 没有这个标记，选择器就没有可以过滤的信号——"私有推理"是语义判断
 * （这段文字是不是 supervisor 在思考要不要批准/怎么分配），不是结构判断
 * （这个字段是不是叫 `private_reasoning`）。本文件对此的诚实处理是：
 *   - **做得到的**：本文件用「白名单」而不是「原样透传」来防止意外泄漏——
 *     只挑 Proposal §14 语义下"子 Agent 执行任务需要"的字段进结果，凡是
 *     不在白名单里的字段（无论叫什么名字、来自哪个 kind）一律不进 Bundle。
 *     如果未来 supervisor 真的把私有推理写进了某个 event 的某个字段（比如
 *     写进 `result_summary` 的自由文本里），白名单挡不住，因为白名单是
 *     "按字段名过滤"，不是"按内容语义过滤"——这正是本条目的诚实边界。
 *   - **做不到的**：不做自由文本内容审查（NLP/关键词扫描"这段话是不是推理"），
 *     schema 没有给这个能力提供锚点，本文件不假装做到。
 *   见下方 `FilteringNotes.not_applicable`——这不是文档注释里的免责声明，
 *   是**运行时返回值的一部分**，调用方（未来的 dispatch 机制）能够拿到
 *   这份"过滤能力边界"清单，而不是被一个看起来干净的 Bundle 误导。
 *
 * ⚠ 诚实标注 2——"无关日志"排除，这部分做得到：
 * WorkflowEvent 有结构化的 `task_id` 字段，可以机械比对。本文件按
 * `task_id` 精确匹配目标 TaskAssignment 的 `instance_id`；子任务展开
 * （`parent_task_id` 链条）需要调用方额外提供 `subtasks` 列表——今天没有
 * 一个"全局 Task Assignment 目录"可查（同 task-assignment-model.ts 文件头
 * 注释："Proposal 没规定 Task Assignment 实例落在哪"），本文件不假装有
 * 这个目录，只在调用方明确传入 `subtasks` 时才做链式展开；不传时只做
 * 精确 task_id 匹配，不隐式假设"没传等于没有子任务"之外的任何东西。
 *
 * 字段级白名单设计理由：
 *   - TaskAssignment 侧只留 `objective`/`scope`/`acceptance_refs`（含
 *     `role_ref` 用作定位）——这是任务书原文点名的三项，也是 Proposal
 *     §14 示例里 `task_ref`/`role_ref` 对应的语义。**故意排除**
 *     `assigned_by`/`dependencies`/`budget`/`authority_snapshot_hash`：
 *     这些是编排层/审计层需要的字段（谁下发的、预算上限、授权快照哈希），
 *     子 Agent 执行任务时不需要知道"谁批的预算""这次下发的授权哈希是
 *     什么"，塞进去只会增加子 Agent 读到跟任务无关信息的面积——这正是
 *     §14 "Specialist Worker 不继承 Root/Domain 的完整对话"这句话在字段
 *     级别的落地。
 *   - WorkflowEvent 侧按 kind 分别留白名单：
 *     `task_assignment` → `assignment_ref`；
 *     `progress` → `delta`/`blockers`/`next_action`/`evidence_refs`；
 *     `blocker` → `blocked_reason`/`next_action`/`evidence_refs`；
 *     `task_result` → `result_summary`/`evidence_refs`。
 *     四类共同保留 `instance_id`/`task_id`/`head_sha`（子 Agent 需要知道
 *     "这条事件是关于哪个 exact SHA 的"，同 workflow-event-renderer.ts
 *     标题行 `task_id · kind · 短 SHA` 的先例）。**故意排除** `actor`
 *     （谁报告的，属于审计溯源，不是执行任务需要的上下文）、
 *     `template_id`/`template_version`（模板元数据，不是内容）、
 *     `sourceFile`（扫描时附加的定位信息，不是文档字段本身，
 *     workflow-event-model.ts 自己也把它标成"非文档字段"）。
 *
 * 范围边界：
 *   - 只做单次 TaskAssignment + WorkflowEvent[] → Bundle 的纯函数选择，
 *     不做 IO、不读文件、不查全局目录。
 *   - 不做 doctor CLI 入口——这是给未来 dispatch 机制（H3A-041 一类条目）
 *     调用的工具函数，不是校验门控，同任务书原文的定位。
 *   - 今天没有任何真实 TaskAssignment/WorkflowEvent 实例（同 H3A-030/033
 *     文件头注释的先例）——本文件的单测全部用构造的 fixture。
 */

import type { TaskAssignment, TaskScope } from "./task-assignment-model";
import type {
  WorkflowEvent,
  WorkflowEventDelta,
  WorkflowEventNextAction,
} from "./workflow-event-model";

/** 白名单后的单条事件形状——按 kind 区分，只保留 §14 语义下"执行任务需要"的字段。 */
export type BundleEventEntry =
  | {
      kind: "task_assignment";
      instance_id: string;
      task_id: string;
      head_sha: string;
      assignment_ref: string;
    }
  | {
      kind: "progress";
      instance_id: string;
      task_id: string;
      head_sha: string;
      delta: WorkflowEventDelta;
      blockers: string[];
      next_action: WorkflowEventNextAction;
      evidence_refs: string[];
    }
  | {
      kind: "blocker";
      instance_id: string;
      task_id: string;
      head_sha: string;
      blocked_reason: string;
      next_action: WorkflowEventNextAction;
      evidence_refs: string[];
    }
  | {
      kind: "task_result";
      instance_id: string;
      task_id: string;
      head_sha: string;
      result_summary: string;
      evidence_refs: string[];
    };

/**
 * 过滤能力的诚实清单——运行时返回值的一部分，不是注释。
 * `applied`：本次调用真实执行了的过滤动作。
 * `not_applicable`：完成契约要求但今天 schema 做不到的语义过滤，附原因。
 */
export interface FilteringNotes {
  applied: string[];
  not_applicable: string[];
}

export interface TaskContextBundle {
  /** 对应 Proposal §14 的 task_ref。 */
  task_ref: string;
  /** 对应 Proposal §14 的 role_ref。 */
  role_ref: string;
  objective: string;
  scope: TaskScope;
  acceptance_refs: string[];
  /** 按 task_id（含子任务链）筛选、按 kind 白名单裁剪后的事件列表。 */
  events: BundleEventEntry[];
  /** 输入事件里出现过、但因 task_id 不相关被排除的 task_id 去重列表——供调用方审计"过滤确实生效了"。 */
  excluded_task_ids: string[];
  filtering_notes: FilteringNotes;
}

export interface BuildTaskContextBundleInput {
  task: TaskAssignment;
  events: WorkflowEvent[];
  /**
   * 已知的子任务 TaskAssignment，用于沿 `parent_task_id` 链条把子任务的
   * Workflow Event 也纳入 Bundle。可选——今天没有全局 Task Assignment 目录
   * 可查（同 task-assignment-model.ts 的诚实标注），调用方能提供多少就是
   * 多少；不传时只按 `task.instance_id` 做精确匹配，不做子任务展开。
   */
  subtasks?: TaskAssignment[];
}

/** 沿 parent_task_id 链条做闭包，收集与 task 相关的全部 task_id（含 task 自身）。 */
function collectRelatedTaskIds(task: TaskAssignment, subtasks: TaskAssignment[]): Set<string> {
  const ids = new Set<string>([task.instance_id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const st of subtasks) {
      if (st.parent_task_id !== null && ids.has(st.parent_task_id) && !ids.has(st.instance_id)) {
        ids.add(st.instance_id);
        changed = true;
      }
    }
  }
  return ids;
}

/** 按 kind 把一条 WorkflowEvent 裁剪成白名单字段——把"意外多带字段"的风险挡在这一步。 */
function whitelistEvent(e: WorkflowEvent): BundleEventEntry {
  const base = { instance_id: e.instance_id, task_id: e.task_id, head_sha: e.head_sha };
  switch (e.kind) {
    case "task_assignment":
      return { ...base, kind: "task_assignment", assignment_ref: e.assignment_ref };
    case "progress":
      return {
        ...base,
        kind: "progress",
        delta: e.delta,
        blockers: e.blockers,
        next_action: e.next_action,
        evidence_refs: e.evidence_refs,
      };
    case "blocker":
      return {
        ...base,
        kind: "blocker",
        blocked_reason: e.blocked_reason,
        next_action: e.next_action,
        evidence_refs: e.evidence_refs,
      };
    case "task_result":
      return { ...base, kind: "task_result", result_summary: e.result_summary, evidence_refs: e.evidence_refs };
  }
}

/**
 * 从一份 TaskAssignment + 一组 WorkflowEvent 里选出交接给子 Agent 的最小
 * Task Context Bundle。纯函数，不做 IO。见文件头注释的诚实标注（做得到/
 * 做不到的过滤边界）。
 */
export function buildTaskContextBundle(input: BuildTaskContextBundleInput): TaskContextBundle {
  const { task, events, subtasks = [] } = input;
  const relatedTaskIds = collectRelatedTaskIds(task, subtasks);

  const relevantEvents: WorkflowEvent[] = [];
  const excludedTaskIds = new Set<string>();
  for (const e of events) {
    if (relatedTaskIds.has(e.task_id)) {
      relevantEvents.push(e);
    } else {
      excludedTaskIds.add(e.task_id);
    }
  }

  const filteringNotes: FilteringNotes = {
    applied: [
      "按 task_id（含 subtasks 参数提供的 parent_task_id 链条闭包）过滤 Workflow Event——" +
        "与目标任务无关的 task_id 已从 events 中排除，见 excluded_task_ids。",
      "按 kind 专属白名单裁剪每条 Workflow Event 的字段——actor/template_id/" +
        "template_version/sourceFile 等审计/元数据字段不进 Bundle。",
      "TaskAssignment 侧只保留 objective/scope/acceptance_refs（+ role_ref 定位）——" +
        "assigned_by/dependencies/budget/authority_snapshot_hash 不进 Bundle。",
    ],
    not_applicable: [
      "无法按语义排除 'supervisor 私有推理'：TaskAssignment/WorkflowEvent 的 schema " +
        "（task-assignment-model.ts / workflow-event-model.ts）都没有专门字段标记" +
        "'这段内容是 supervisor 的私有推理过程'，本选择器只能做结构化的字段/task_id 过滤，" +
        "排不出这个语义——如果推理文字混进了白名单字段的自由文本里（例如 result_summary），" +
        "本函数挡不住。",
    ],
  };

  return {
    task_ref: task.instance_id,
    role_ref: task.assignee_role,
    objective: task.objective,
    scope: task.scope,
    acceptance_refs: task.acceptance_refs,
    events: relevantEvents.map(whitelistEvent),
    excluded_task_ids: Array.from(excludedTaskIds).sort(),
    filtering_notes: filteringNotes,
  };
}
