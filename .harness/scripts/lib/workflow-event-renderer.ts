/**
 * workflow-event-renderer.ts —— PROP-HARNESS-AGENT-001 H3A-035（Epic E3，依赖
 * H3A-033 的 TPL-EVT-001 四类 Workflow Event envelope，见 workflow-event-model.ts）。
 *
 * 完成契约原文（checklist）："12 行短文本 renderer | 033 | 普通事件默认不超过 12 行"。
 *
 * Proposal 支撑原文：
 *
 * §13.2「普通消息的人类视图」给出唯一逐字示例（`kind: progress` 场景）：
 *
 *   TSK-658-canvas-01 · progress · abcdef1
 *   变化：stableNodeId 映射已实现
 *   阻塞：无
 *   证据：EVD-canvas-unit-0042
 *   下一步：canvas-verifier 验证 exact SHA
 *
 * 紧接一句原文："普通事件默认不超过 12 行。只有 ADR、多方案权衡、事故复盘、
 * 人类签核材料和 P0/P1 finding 允许长篇 Markdown。"（PROP-HARNESS-AGENT-001.md:766）
 * §19 成功指标重复同一约束："普通事件人类视图不超过 12 行"（line 905）。
 *
 * ⚠ 诚实标注：Proposal 只给了 `progress` 这一种 kind 的渲染示例。下面对
 * `task_assignment`/`blocker`/`task_result` 三种 kind 具体渲染哪些字段、
 * 每类摘要展示几条、截断策略的阈值——这些都是**本条目的设计决策，不是
 * Proposal 逐字规定**（同 H3A-033 处理"推断字段"的诚实标注先例，见
 * workflow-event-model.ts 文件头注释）。设计依据：
 *   - 首行统一沿用 §13.2 给出的唯一逐字格式：`task_id · kind · 短 SHA`。
 *     这是 Proposal 唯一明确给出的格式片段，四类 kind 都复用它作为标题行，
 *     不为每个 kind 另造一套标题格式。
 *   - 每类 kind 的正文字段选择参考 git commit 短格式的思路："一行说清楚
 *     这条事件是什么" + 关键字段摘要，字段选择对齐 §12.1 表格里各 kind
 *     的语义角色（Progress: 只报告新增事实和证据；Blocker: 请求范围外决策；
 *     Task Result: 陈述产出，不隐含 APPROVE）。
 *   - `evidence_refs` / `delta.implemented` / `blockers` 等数组字段若过长，
 *     用"显示前 N 条 + 还有 M 条"的摘要策略截断，不是硬砍到看不出内容——
 *     这是完成契约里"字段内容超长时不能让内容溢出行数限制"的直接要求。
 *     具体的 N 是本条目为了在 12 行预算内给每个 kind 留出标题行 + 若干
 *     正文行而选定的数值，不是 Proposal 规定的固定常数：`progress` 是四类
 *     kind 里数组字段最多的一种（`delta.implemented` + `blockers` +
 *     `evidence_refs` 三个数组字段 + 标题行 + next_action 固定占 2 行），
 *     要保证它的最坏情形（三个数组字段都超长）仍然 ≤12 行，N 必须满足
 *     `2 + 3 × (N + 1) ≤ 12`，即 N ≤ 2.33——取 N=2（每条摘要最多显示 2 项
 *     + 1 条"还有 M 条"提示行 = 每个数组字段最多 3 行，三个字段合计 9 行，
 *     加标题与 next_action 共 11 行，在 12 行预算内留有余量）。其余三类
 *     kind 数组字段更少，同一个 N 值天然更宽松，不需要按 kind 分别调参。
 *
 * `verbose` 可选参数：Proposal 原文暗示"默认"之外存在允许更长的场景
 * （ADR、事故复盘等），但那些场景本身就不是 TPL-EVT-001 普通事件的渲染
 * 对象（Proposal 原文把它们排除在"普通事件"之外，用的是完全不同的长篇
 * Markdown 载体）。这里只加一个最小的 `verbose` 开关，放开截断策略、
 * 完整展开数组字段，不做过度设计的复杂配置系统（分级详细度、自定义字段
 * 选择器等一律不做，Proposal 没有要求）。
 *
 * 范围边界：
 *   - 只做单份 WorkflowEvent → string[] 的纯函数渲染，不做 IO、不读文件、
 *     不写 stdout。
 *   - 输入假定已经过 H3A-033 的 validateWorkflowEvent 校验；本文件不重新
 *     校验字段合法性，只负责渲染已知合法的实例。
 */

import type {
  WorkflowEvent,
  WorkflowEventNextAction,
} from "./workflow-event-model";

/** 普通事件（非 verbose）的默认行数上限——完成契约原文逐字规定。 */
export const DEFAULT_MAX_LINES = 12;

/**
 * 数组字段摘要时默认展示的最大条目数。取值推导见文件头注释——
 * `progress` kind 有三个数组字段，N=2 是保证其最坏情形仍 ≤12 行的最大值。
 */
const SUMMARY_ITEM_LIMIT = 2;

export interface RenderWorkflowEventOptions {
  /**
   * true 时不做 12 行预算内的截断——用于允许长篇渲染的场景（ADR、事故复盘等，
   * 这些本身不是 TPL-EVT-001 普通事件，见文件头注释）。默认 false。
   */
  verbose?: boolean;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/** §13.2 逐字格式："task_id · kind · 短 SHA"，四类 kind 共用同一标题行。 */
function renderHeaderLine(event: WorkflowEvent): string {
  return `${event.task_id} · ${event.kind} · ${shortSha(event.head_sha)}`;
}

/**
 * 把字符串数组渲染成"显示前 N 条 + 还有 M 条"的摘要行数组（每条目一行）。
 * verbose 为 true 时不截断，完整展开。
 */
function renderListSummary(label: string, items: string[], verbose: boolean): string[] {
  if (items.length === 0) {
    return [`${label}：无`];
  }
  const limit = verbose ? items.length : SUMMARY_ITEM_LIMIT;
  const shown = items.slice(0, limit);
  const lines = shown.map((item, i) => `${label}${i === 0 ? "" : "  "}：${item}`);
  const remaining = items.length - shown.length;
  if (remaining > 0) {
    lines.push(`${label}（续）：还有 ${remaining} 条，见 evidence_refs/完整事件记录`);
  }
  return lines;
}

function renderNextActionLine(nextAction: WorkflowEventNextAction): string {
  return `下一步：${nextAction.owner_role} ${nextAction.action}`;
}

function renderEvidenceRefsLines(event: WorkflowEvent, verbose: boolean): string[] {
  return renderListSummary("证据", event.evidence_refs, verbose);
}

/** kind === "progress" 的正文渲染——§13.2 唯一逐字示例覆盖的场景。 */
function renderProgressBody(event: Extract<WorkflowEvent, { kind: "progress" }>, verbose: boolean): string[] {
  const lines: string[] = [];
  lines.push(...renderListSummary("变化", event.delta.implemented, verbose));
  lines.push(...renderListSummary("阻塞", event.blockers, verbose));
  lines.push(...renderEvidenceRefsLines(event, verbose));
  lines.push(renderNextActionLine(event.next_action));
  return lines;
}

/** kind === "task_assignment" 的正文渲染——设计决策，见文件头注释。 */
function renderTaskAssignmentBody(event: Extract<WorkflowEvent, { kind: "task_assignment" }>, verbose: boolean): string[] {
  const lines: string[] = [];
  lines.push(`下发/确认：${event.assignment_ref}`);
  lines.push(`actor：${event.actor}`);
  lines.push(...renderEvidenceRefsLines(event, verbose));
  return lines;
}

/** kind === "blocker" 的正文渲染——设计决策，见文件头注释。 */
function renderBlockerBody(event: Extract<WorkflowEvent, { kind: "blocker" }>, verbose: boolean): string[] {
  const lines: string[] = [];
  lines.push(`阻塞原因：${event.blocked_reason}`);
  lines.push(...renderEvidenceRefsLines(event, verbose));
  lines.push(renderNextActionLine(event.next_action));
  return lines;
}

/** kind === "task_result" 的正文渲染——设计决策，见文件头注释。 */
function renderTaskResultBody(event: Extract<WorkflowEvent, { kind: "task_result" }>, verbose: boolean): string[] {
  const lines: string[] = [];
  lines.push(`产出：${event.result_summary}`);
  lines.push(...renderEvidenceRefsLines(event, verbose));
  return lines;
}

/**
 * 把一份已校验通过的 WorkflowEvent 渲染成人类可读的短文本行数组。
 *
 * 默认（非 verbose）情况下总行数 ≤ DEFAULT_MAX_LINES（=12，完成契约原文）。
 * 这不是"尽量不超过"——是硬保证：即便某个数组字段真的很长（比如
 * evidence_refs 有 20 条），renderListSummary 的截断策略也会把它压缩到
 * 摘要行 + "还有 N 条"提示，不会让总行数溢出。
 */
export function renderWorkflowEvent(event: WorkflowEvent, options: RenderWorkflowEventOptions = {}): string[] {
  const verbose = options.verbose ?? false;
  const lines: string[] = [renderHeaderLine(event)];

  switch (event.kind) {
    case "progress":
      lines.push(...renderProgressBody(event, verbose));
      break;
    case "task_assignment":
      lines.push(...renderTaskAssignmentBody(event, verbose));
      break;
    case "blocker":
      lines.push(...renderBlockerBody(event, verbose));
      break;
    case "task_result":
      lines.push(...renderTaskResultBody(event, verbose));
      break;
  }

  return lines;
}
