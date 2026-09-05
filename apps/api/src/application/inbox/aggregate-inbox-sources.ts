/**
 * `aggregateInboxSources`（UC-17.8 B6.4）—— `listInbox` / `getInboxCounts` 共用的**三源拉取 +
 * 可观测性**一步。
 *
 * ## 为什么把拉取从两个用例里抽出来
 *
 * B3.2 之后两个用例各自写了一遍"拉反馈 → 拉系统异常（受 cap）→ 拉设计项目"，B4.3 接入设计
 * 方案时两边又各改一次。B6.4 要给这一步加日志/指标——再在两处各加一遍就是第三次复制同一件事
 * （`observability.md`：可观测性属于 harness 的一部分，不是事后补丁；AGENTS.md：同一事实不得
 * 声明在两处）。抽成一个函数后，"三源各拉了多少行、花了多久、异常源有没有撞
 * `INBOX_EXCEPTION_FETCH_CAP`、是不是 withheld"这些事实只在这里测一次，两个用例各自只补
 * 自己那一段的结果（返回条数 / 是否有下一页）。
 *
 * ## 日志里**没有**什么
 *
 * 反馈正文、标题、提交人显示名、邮箱、搜索词原文——一个都不进日志。日志是给值班看"慢在哪、
 * 撞没撞上限"的，不是第二份可以绕过 D3 门控读正文的通道（`feedback-detail-decision.ts`
 * 的可见性判定只在响应里生效，日志若带正文就等于给了一个没有门的旁路）。`q` 只记
 * `qPresent: boolean`。
 *
 * ## 指标即字段
 *
 * 本仓没有独立的 metrics 端口（`application/ports/` 只有 `LoggerPort`），"指标"按
 * `observability.md` 的三件套落成结构化日志字段：`durationMs` / 各源行数 / `capHit`，
 * 由日志管道按 `msg` 聚合。不为这一条引入新依赖。
 */
import type { z } from "zod";
import type { inbox as C } from "@repo/contracts";
import { listFeedback, type ListFeedbackDeps, type ListFeedbackInput, type FeedbackItemView } from "../feedback/list-feedback";
import type { ErrorLogListItem, ErrorLogPort } from "../ports/error-log.port";
import type { LoggerPort, LogFields } from "../ports/logger.port";
import { loadOwnerNamesAndProject } from "../design-workbench/project-list-shared";
import type { DesignProjectDeps, DesignProjectView } from "../design-workbench/project-shared";
import { fetchAllExceptions, INBOX_EXCEPTION_FETCH_CAP } from "./inbox-projection";

export type InboxSourcesView = z.infer<typeof C.InboxSources>;

/**
 * 可观测性依赖——**都是可选的**：用例的单测（fake 端口）不需要 logger；controller 注入
 * `LOGGER_PORT` 并透传 `traceIdOf(req)`，让这一条日志能和 `AllExceptionsFilter` 记的错误按同一个
 * `traceId` 关联（`logger.port.ts` 头注 I-11）。
 */
export interface InboxObservabilityDeps {
  readonly logger?: LoggerPort;
  readonly traceId?: string;
}

export interface InboxAggregateDeps extends InboxObservabilityDeps {
  readonly feedback: ListFeedbackDeps;
  readonly errorLog: ErrorLogPort | undefined;
  readonly design: DesignProjectDeps;
}

export type InboxAggregateInput = Pick<ListFeedbackInput, "viewerId" | "viewerOrgRole" | "viewerTeamId">;

/** 一次聚合的事实——日志字段的唯一来源；`listInbox`/`getInboxCounts` 只往上追加自己那几项。 */
export interface InboxAggregateStats {
  readonly feedbackRows: number;
  readonly exceptionRows: number;
  /** `design_projects` 全部行（含未推送——投影阶段才筛 `pushed`），与 `listForOrg` 的行数一致。 */
  readonly designRows: number;
  readonly exceptionSource: InboxSourcesView["exception"];
  readonly exceptionCapHit: boolean;
  readonly exceptionFetchCap: number;
  readonly feedbackMs: number;
  readonly exceptionMs: number;
  readonly designMs: number;
}

export interface InboxAggregateResult {
  readonly feedbackItems: readonly FeedbackItemView[];
  readonly exceptionItems: readonly ErrorLogListItem[];
  readonly designItems: readonly DesignProjectView[];
  readonly sources: InboxSourcesView;
  readonly stats: InboxAggregateStats;
}

/** 没有请求级 traceId 时的固定值——同 `triage-feedback.ts` 用固定 traceId 的理由。 */
const FALLBACK_TRACE_ID = "inbox-aggregate";

export async function aggregateInboxSources(
  deps: InboxAggregateDeps,
  input: InboxAggregateInput,
): Promise<InboxAggregateResult> {
  const sources: InboxSourcesView = { exception: deps.errorLog !== undefined ? "included" : "withheld" };

  const t0 = Date.now();
  const feedbackItems = await listFeedback(deps.feedback, {
    scope: { kind: "org" },
    viewerId: input.viewerId,
    viewerOrgRole: input.viewerOrgRole,
    viewerTeamId: input.viewerTeamId,
  });
  const t1 = Date.now();
  const exceptions = deps.errorLog !== undefined ? await fetchAllExceptions(deps.errorLog) : { items: [], capHit: false };
  const t2 = Date.now();
  const designRows = await deps.design.projects.listForOrg();
  const designItems = await loadOwnerNamesAndProject(deps.design, designRows);
  const t3 = Date.now();

  return {
    feedbackItems,
    exceptionItems: exceptions.items,
    designItems,
    sources,
    stats: {
      feedbackRows: feedbackItems.length,
      exceptionRows: exceptions.items.length,
      designRows: designRows.length,
      exceptionSource: sources.exception,
      exceptionCapHit: exceptions.capHit,
      exceptionFetchCap: INBOX_EXCEPTION_FETCH_CAP,
      feedbackMs: t1 - t0,
      exceptionMs: t2 - t1,
      designMs: t3 - t2,
    },
  };
}

/**
 * 一次聚合一条 `info`。`op` 区分两个用例；`extra` 是用例自己那几项（不许带正文/邮箱/搜索词）。
 * 撞上限**同一条**日志里 `exceptionCapHit: true`——不另起一条 `error`：它不是故障，是取舍
 * 的边界被碰到了，值班按字段筛就能看到，而 `error` 级会把 `AllExceptionsFilter` 那条真正的
 * 异常淹掉。
 */
export function logInboxAggregation(
  deps: InboxObservabilityDeps,
  op: "listInbox" | "getInboxCounts",
  orgId: string,
  stats: InboxAggregateStats,
  startedAt: number,
  extra: Readonly<Record<string, string | number | boolean | null>> = {},
): void {
  if (deps.logger === undefined) return;
  const fields: LogFields = {
    traceId: deps.traceId ?? FALLBACK_TRACE_ID,
    op,
    orgId,
    ...stats,
    durationMs: Date.now() - startedAt,
    ...extra,
  };
  deps.logger.info(`inbox: ${op} aggregation`, fields);
}
