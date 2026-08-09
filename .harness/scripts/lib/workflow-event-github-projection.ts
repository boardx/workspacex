/**
 * workflow-event-github-projection.ts —— PROP-HARNESS-AGENT-001 H3A-039
 * （Epic E3，依赖 H3A-033/034/035/036/037）。
 *
 * 完成契约原文（`docs/proposals/PROP-HARNESS-AGENT-001.checklist.md`
 * H3A-039）："GitHub 评论结构化投影 | 033–037 | Board 可可靠解析最新事件，
 * 不猜标题"。
 *
 * 本条目在 H3A-035 的 12 行人类可读渲染器（workflow-event-renderer.ts）
 * 之外**再包一层机器可解析的 envelope**，让"Board"（读 GitHub 评论的程序）
 * 能从一堆真实评论（人类闲聊 + 结构化事件混杂）里可靠地找出最新一条结构化
 * 事件，不需要靠猜标题文字或按评论 `created_at` 排序去蒙。
 *
 * 设计三部分：
 *   1. `renderGithubStructuredComment` —— WorkflowEvent | ReviewDecision →
 *      一段结构化 GitHub 评论文本（固定格式的 HTML 注释标记 + 复用/新增的
 *      人类可读渲染内容）。
 *   2. `parseGithubStructuredComment` —— 一段评论文本 → 是否结构化事件，
 *      是则给出 `instanceId`/`kind`/`templateId`/`seq`；不是则返回 `null`，
 *      不做启发式猜测（这是完成契约"不猜标题"逐字要求）。
 *   3. `selectLatestStructuredProjection` —— 一组评论（混杂人类闲聊）→
 *      去重 + 排序后的最新结构化事件。
 *
 * ⚠ 诚实标注 1——为什么标记里有一个 `seq` 字段，而它**不是** H3A-033/036
 * 两份 schema 本身携带的字段：
 *   Proposal 与 H3A-033/034/036 都没有为 WorkflowEvent/ReviewDecision 定义
 *   任何"实例间可比较的顺序号"字段——`instance_id` 只保证唯一（H3A-034），
 *   不保证跨实例可排序（示例 `EVT-658-0007` 的数字后缀是人类可读的命名习惯，
 *   不是 schema 规定的、可安全 parseInt 比较的顺序字段；不同 task_id 下的
 *   计数器是否共享、是否连续，Proposal 完全没有规定）。
 *   完成契约明确要求"按某个可靠字段排序，不是评论 created_at"（本条目任务
 *   说明原文）——而"可靠"的前提是这个字段的语义被明确定义、单调递增。今天
 *   仓库里没有这样的字段，所以本文件**不**假装从 `instance_id` 猜出顺序
 *   （那正是完成契约要求避免的"猜"），而是要求调用方（发布这条评论的
 *   emitter，通常是同一个 task_id 下持续产出 Progress 事件的 agent）在渲染
 *   时显式传入单调递增的 `seq`——emitter 自己知道"这是我在这个 task_id 下
 *   发的第几条事件"，这是它能诚实提供、不需要猜的信息（同 H3A-037
 *   `resolvedHeadSha` "调用方负责解析好事实，纯函数不猜"的分层先例）。
 *   `seq` 的可比较范围是**同一 `instance stream`**（本文件用
 *   `task_id + kind`，见下方"诚实标注 3"）——跨 stream 的 `seq` 数值不必
 *   有意义，Board 选最新时按 stream 分组比较，不做全局跨 stream 比较（同样
 *   见"诚实标注 3"）。
 *
 * ⚠ 诚实标注 2——为什么 ReviewDecision 需要本文件另写一段"人类可读正文"
 * 而不是复用 H3A-035：
 *   H3A-035 `renderWorkflowEvent` 的类型签名和文件头部范围声明都明确只覆盖
 *   `WorkflowEvent`（TPL-EVT-001 四类 kind），完成契约原文写的是"TPL-EVT-001
 *   可解析"。ReviewDecision（TPL-RVW-001）是本条目任务说明里"Board 大概率也
 *   要能解析这类评论"提出的扩展需求，H3A-035 没有覆盖、也不应该被本条目
 *   反过来塞进去改动它的范围。本文件因此只在**本文件内部**新增一个最小的
 *   `renderReviewDecisionLines`——字段选择直接照抄 review-decision-model.ts
 *   的字段清单（reviewer/producer/exact_sha/decision/findings 数量），不
 *   重新发明；不去改 H3A-035 那个文件，避免越界扩大它的范围（同 AGENTS.md
 *   "范围纪律：只动当前 feature 涉及的代码"）。
 *
 * ⚠ 诚实标注 3——"kind" 字段在标记里对 ReviewDecision 的取值：
 *   ReviewDecision 本身没有 `kind` 字段（它只有一个 `template_id` 就是
 *   `TPL-RVW-001`，不像 WorkflowEvent 有四选一枚举）。为了让 Board 不用先
 *   查 `template_id` 才知道"这是不是 Review Decision"，标记里统一给一个
 *   `kind`：WorkflowEvent 直接用它自己的 `kind`；ReviewDecision 填常量
 *   `"review_decision"`（本文件定义，不是 Proposal 或 H3A-036 规定的字段，
 *   纯粹是本文件为了让 Board 只看一行标记就能分流两大类记录而做的设计
 *   决策）。"stream" 的分组键相应地是 `template_id + instance owner 维度`：
 *   WorkflowEvent 用 `task_id + kind`（同一任务同一类事件的时间线），
 *   ReviewDecision 用 `task_id`（同一任务的审查决定时间线）——都不是全局，
 *   因为不同任务/不同 kind 的 `seq` 计数器彼此无关，混着比较没有意义。
 *
 * 范围边界：
 *   - 本文件是纯函数，不做任何真实 IO——不调用 `gh` CLI、不调用 GitHub
 *     API、不发真实评论（同任务说明"验证阶段只做本地渲染 + dry-run"的
 *     边界要求）。真实发评论/拉取评论列表是未来把这层接到
 *     `sync-github.ts`/`pr-queue.ts` 一类 IO 脚本时的事，不在本条目范围。
 *   - 不管评论是否来自可信来源、评论作者是否有权限——GitHub 评论的可信度/
 *     权限校验是另一层关注点，不是"文本能不能被结构化解析"这件事本身。
 */

import type { WorkflowEvent, WorkflowEventKind } from "./workflow-event-model";
import type { ReviewDecision } from "./review-decision-model";
import { renderWorkflowEvent } from "./workflow-event-renderer";

/** 标记行的固定前缀——Board 用它在评论文本里定位机器可解析的 envelope。 */
export const GITHUB_PROJECTION_MARKER_TAG = "H3A-EVENT" as const;

/** ReviewDecision 在标记里的合成 kind 值——见文件头"诚实标注 3"。 */
export const REVIEW_DECISION_PROJECTION_KIND = "review_decision" as const;

export type ProjectableRecord = WorkflowEvent | ReviewDecision;

function isWorkflowEvent(record: ProjectableRecord): record is WorkflowEvent {
  return record.template_id === "TPL-EVT-001";
}

/** 标记里 kind 字段的取值：WorkflowEvent 用自身 kind，ReviewDecision 用合成常量。 */
function projectionKind(record: ProjectableRecord): WorkflowEventKind | typeof REVIEW_DECISION_PROJECTION_KIND {
  return isWorkflowEvent(record) ? record.kind : REVIEW_DECISION_PROJECTION_KIND;
}

/**
 * stream 分组键——同一个 stream 内 `seq` 才可比较，见文件头"诚实标注 3"。
 * WorkflowEvent: task_id + kind；ReviewDecision: task_id。
 */
export function projectionStreamKey(record: ProjectableRecord): string {
  return isWorkflowEvent(record) ? `${record.task_id}::${record.kind}` : `${record.task_id}::${REVIEW_DECISION_PROJECTION_KIND}`;
}

/**
 * 固定格式的机器可解析标记行。字段顺序固定、`key=value` 空格分隔、
 * 单行、不含需要转义的字符（`instance_id`/`task_id` 约定不含空格，同
 * H3A-033/036 示例风格）——Board 解析时用锚定整行的正则精确匹配，不做
 * 模糊猜测。
 */
export function renderProjectionMarker(record: ProjectableRecord, seq: number): string {
  const fields = [
    `template_id=${record.template_id}`,
    `instance_id=${record.instance_id}`,
    `kind=${projectionKind(record)}`,
    `task_id=${record.task_id}`,
    `seq=${seq}`,
  ];
  return `<!-- ${GITHUB_PROJECTION_MARKER_TAG}: ${fields.join(" ")} -->`;
}

/** ReviewDecision 的最小人类可读正文——字段选择直接照抄 schema，见"诚实标注 2"。 */
function renderReviewDecisionLines(decision: ReviewDecision): string[] {
  const lines: string[] = [`${decision.task_id} · review_decision · ${decision.decision}`];
  lines.push(`reviewer：${decision.reviewer}`);
  lines.push(`producer：${decision.producer}`);
  lines.push(`exact_sha：${decision.exact_sha}`);
  lines.push(`evidence：${decision.evidence_refs.length} 条`);
  lines.push(`findings：${decision.findings.length} 条`);
  return lines;
}

export interface RenderGithubStructuredCommentOptions {
  /** 透传给 renderWorkflowEvent 的 verbose 开关（只对 WorkflowEvent 生效，见 H3A-035）。 */
  verbose?: boolean;
}

/**
 * 渲染一段结构化 GitHub 评论文本：第一行固定格式的机器标记，空一行，
 * 接人类可读正文（WorkflowEvent 复用 H3A-035 的 renderWorkflowEvent；
 * ReviewDecision 用本文件的 renderReviewDecisionLines）。
 *
 * `seq` 由调用方提供，语义见文件头"诚实标注 1"：同一 stream
 * （`projectionStreamKey`）内必须单调递增，本函数不校验也不猜测——校验
 * 单调性是 emitter 自己的责任（同 append-only gate 的分层先例，真实性
 * 校验放在有历史可查的地方，纯渲染函数不做）。
 */
export function renderGithubStructuredComment(
  record: ProjectableRecord,
  seq: number,
  options: RenderGithubStructuredCommentOptions = {},
): string {
  const markerLine = renderProjectionMarker(record, seq);
  const bodyLines = isWorkflowEvent(record) ? renderWorkflowEvent(record, { verbose: options.verbose }) : renderReviewDecisionLines(record);
  return [markerLine, "", ...bodyLines].join("\n");
}

export interface ParsedGithubProjection {
  templateId: string;
  instanceId: string;
  kind: string;
  taskId: string;
  seq: number;
  streamKey: string;
  /** 原始评论全文，供调用方需要时回溯人类可读正文。 */
  rawBody: string;
}

/**
 * 标记行的精确正则——字段顺序、拼写都必须与 `renderProjectionMarker` 完全
 * 一致（同一份"什么算结构化标记"的定义，渲染和解析共用这一个正则常量，
 * 避免两处各写一份、漂移出第二事实源——同 AGENTS.md"同一事实不得声明在
 * 两处"的硬约束）。
 */
const MARKER_REGEX =
  /<!-- H3A-EVENT: template_id=(\S+) instance_id=(\S+) kind=(\S+) task_id=(\S+) seq=(-?\d+) -->/;

/**
 * 判定一段 GitHub 评论文本是不是结构化事件、并提取机器字段。
 *
 * 没有匹配到固定标记 → 返回 `null`，判定为"非结构化"（人类闲聊评论、
 * 或格式被破坏的评论）——不做任何"这条评论看起来像不像事件"的启发式猜测，
 * 这正是完成契约"不猜标题"的逐字要求。`seq` 解析失败（非法数字）同样判
 * `null`，因为标记本身已经不可信，不能只信一半字段。
 */
export function parseGithubStructuredComment(commentBody: string): ParsedGithubProjection | null {
  const match = MARKER_REGEX.exec(commentBody);
  if (!match) return null;

  const [, templateId, instanceId, kind, taskId, seqRaw] = match;
  const seq = Number(seqRaw);
  if (!Number.isInteger(seq)) return null;

  return {
    templateId: templateId!,
    instanceId: instanceId!,
    kind: kind!,
    taskId: taskId!,
    seq,
    streamKey: `${taskId}::${kind}`,
    rawBody: commentBody,
  };
}

export interface GithubCommentLike {
  /** 评论在 GitHub 上的稳定标识（issue/PR comment id）——仅用于去重时保留哪一条的追溯，不参与排序。 */
  id: string | number;
  body: string;
}

/**
 * 从一组（可能混杂人类闲聊评论的）GitHub 评论里提取全部结构化事件，按
 * `instance_id` 去重——同一 `instance_id` 理论上不该出现两条不同内容的评论
 * （H3A-034 append-only 语义），但如果真的出现了（比如评论被编辑过、或有
 * 实现 bug 重复发了两次），保留 `seq` 更大的那条，`seq` 相同则保留数组里
 * 更靠后的那条（调用方约定按评论在数组里的自然顺序传入，通常就是 GitHub
 * 返回的分页顺序；这不是"按 created_at 排序"，只是并列时的确定性 tie-break，
 * 不影响"按 seq 选最新"这条主排序规则）。
 */
export function parseAllStructuredProjections(comments: readonly GithubCommentLike[]): ParsedGithubProjection[] {
  const byInstanceId = new Map<string, ParsedGithubProjection>();
  for (const comment of comments) {
    const parsed = parseGithubStructuredComment(comment.body);
    if (!parsed) continue; // 人类闲聊评论 / 非结构化——跳过，不猜
    const existing = byInstanceId.get(parsed.instanceId);
    if (!existing || parsed.seq >= existing.seq) {
      byInstanceId.set(parsed.instanceId, parsed);
    }
  }
  return [...byInstanceId.values()];
}

/**
 * Board 的核心操作：给一组混杂评论，挑出"最新的那条结构化事件"。
 *
 * 排序字段是标记里的 `seq`（emitter 显式提供，见文件头"诚实标注 1"），
 * **不是**评论的 `created_at`——完成契约任务说明原文要求。同一 stream
 * （`projectionStreamKey` 同款分组键，见"诚实标注 3"）内 `seq` 更大者更新；
 * 跨 stream 的 `seq` 不保证可比较，所以本函数默认只在**全部去重后的实例里
 * 找 `seq` 最大的一条**——调用方如果需要"某个特定 task_id/kind 组合下的最新
 * 事件"，应该先按 `streamKey` 过滤（`parseAllStructuredProjections` 返回的
 * 每一条都带 `streamKey` 字段），再对过滤结果调用本函数或直接取 `seq` 最大
 * 者。这里不替调用方做"该关心哪个 stream"的判断，避免编一个 Proposal 没有
 * 定义的跨 stream 优先级规则。
 *
 * 没有任何结构化评论 → 返回 `null`（不是错误，是"这个 issue/PR 下今天还没
 * 有结构化事件"这一真实状态）。
 */
export function selectLatestStructuredProjection(comments: readonly GithubCommentLike[]): ParsedGithubProjection | null {
  const all = parseAllStructuredProjections(comments);
  if (all.length === 0) return null;
  return all.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
}
