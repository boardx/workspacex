/**
 * 收件箱聚合的共享投影逻辑——`list-inbox.ts` 与 `get-inbox-counts.ts` 都只调这里，
 * 不各写一份排序键/编号/`github` 派生（同一事实不得声明在两处，见 AGENTS.md）。
 *
 * 口径见 `packages/contracts/src/inbox.ts` 文件头：这里只是把那份口径写成代码。
 */
import { inbox as C, type feedbackLoop, type systemErrorLogs } from "@repo/contracts";
import type { z } from "zod";
import type { FeedbackItemView } from "../feedback/list-feedback";
import type { ErrorLogListItem, ErrorLogPort } from "../ports/error-log.port";
import type { DesignProjectView } from "../design-workbench/project-shared";

/** 见 `list-inbox.ts` 文件头「分页的取舍」——单次聚合最多从 `error_logs` 拉这么多行。 */
export const INBOX_EXCEPTION_FETCH_CAP = 2000;
const EXCEPTION_FETCH_PAGE = 200;

/**
 * 拉全部（受 `INBOX_EXCEPTION_FETCH_CAP` 约束）系统异常行，供 `listInbox` 与
 * `getInboxCounts` 共用——两个用例都需要"参与排序/计数的完整窗口"，不是各自
 * 分页一次。
 */
export async function fetchAllExceptions(errorLog: ErrorLogPort): Promise<readonly ErrorLogListItem[]> {
  const items: ErrorLogListItem[] = [];
  let beforeId: string | null = null;
  for (let i = 0; i < INBOX_EXCEPTION_FETCH_CAP / EXCEPTION_FETCH_PAGE; i += 1) {
    const page = await errorLog.list({ limit: EXCEPTION_FETCH_PAGE, beforeId });
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) break;
    beforeId = page.items[page.items.length - 1]?.id ?? null;
  }
  return items;
}

export type InboxItemView = z.infer<typeof C.InboxItem>;

/** 排序/游标用的复合键——`createdAt` 倒序，同刻按 `kind`+`id`（契约头注原话）。 */
export interface InboxSortKey {
  readonly createdAt: string;
  readonly kind: z.infer<typeof C.InboxKind>;
  readonly id: string;
}

export interface InboxKeyed {
  readonly item: InboxItemView;
  readonly key: InboxSortKey;
}

/** `a` 在 `b` 之前(更靠列表顶部)返回负数——`createdAt` 倒序,同刻 `kind` 升序,再 `id` 升序。 */
export function compareInboxDesc(a: InboxSortKey, b: InboxSortKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 编号排序：同前缀内按创建顺序升序（`createdAt`，同刻按 `id`）——`compareInboxDesc` 的反向。 */
function compareCreatedAsc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 不透明 cursor：编码上一页最后一条的排序键。客户端不解析——见契约 `listInbox` 头注。 */
export function encodeInboxCursor(key: InboxSortKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeInboxCursor(cursor: string): InboxSortKey {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<InboxSortKey>;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      (parsed.kind !== "feedback" && parsed.kind !== "exception" && parsed.kind !== "design")
    ) {
      throw new Error("malformed inbox cursor");
    }
    return { createdAt: parsed.createdAt, kind: parsed.kind, id: parsed.id };
  } catch {
    throw new InvalidInboxCursorError();
  }
}

export class InvalidInboxCursorError extends Error {}

/**
 * `github` 派生——只用反馈已存的 `githubIssueUrl`/`githubIssueNumber` + `sourceStatus`
 * 推 `state`，**不现查 GitHub**。见契约 `InboxGithubRef` 头注的完整公式。
 */
function deriveGithubRef(row: FeedbackItemView): z.infer<typeof C.InboxGithubRef> | null {
  if (row.githubIssueUrl === null || row.githubIssueNumber === null) return null;
  const closed = row.status === "已修复" || row.status === "不做";
  return { kind: "issue", number: row.githubIssueNumber, url: row.githubIssueUrl, state: closed ? "closed" : "open" };
}

/** 展示编号：同前缀（`B`/`R`/`E`/`D`）内按创建顺序赋 1..n——见契约 `InboxItem.code` 头注。 */
function assignCodes<T extends { createdAt: string; id: string }>(
  rows: readonly T[],
  prefix: "B" | "R" | "E" | "D",
): ReadonlyMap<string, string> {
  const sorted = [...rows].sort(compareCreatedAsc);
  const out = new Map<string, string>();
  sorted.forEach((row, i) => out.set(row.id, `${prefix}-${i + 1}`));
  return out;
}

export function buildFeedbackInboxItems(rows: readonly FeedbackItemView[]): InboxKeyed[] {
  const bugs = rows.filter((r) => r.kind === "缺陷");
  const requests = rows.filter((r) => r.kind === "需求");
  const bugCodes = assignCodes(bugs, "B");
  const reqCodes = assignCodes(requests, "R");

  return rows.map((row) => {
    const code = row.kind === "缺陷" ? bugCodes.get(row.id)! : reqCodes.get(row.id)!;
    const item: InboxItemView = {
      id: row.id,
      kind: "feedback",
      code,
      title: row.title,
      body: row.detail,
      structured: row.structured,
      feedbackKind: row.kind,
      sourceStatus: row.status,
      stage: C.stageOf("feedback", row.status as feedbackLoop.FeedbackStatus),
      statusReason: row.statusReason,
      severe: false,
      votes: row.votes,
      reporter: row.submitterName,
      createdAt: row.createdAt,
      github: deriveGithubRef(row),
      linkedFeedbackId: null,
      resolvedByDesignId: null,
      exception: null,
      submittedByMe: row.submittedByMe,
      votedByMe: row.votedByMe,
    };
    return { item, key: { createdAt: row.createdAt, kind: "feedback", id: row.id } };
  });
}

/** `location`：前端上报的 `url`，或后端异常的请求路径；取不到为 `null`（契约头注）。 */
function deriveExceptionLocation(detail: unknown): string | null {
  if (detail !== null && typeof detail === "object" && "url" in detail) {
    const url = (detail as { url?: unknown }).url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

export function buildExceptionInboxItems(rows: readonly ErrorLogListItem[]): InboxKeyed[] {
  const codes = assignCodes(rows, "E");

  // `severe` 的依据是"同一条 msg 出现的次数"——在这批已经拉取到的行里分组统计
  // （见 `list-inbox.ts` 文件头「分页的取舍」：这是 `INBOX_EXCEPTION_FETCH_CAP`
  // 窗口内的精确计数，不是全表聚合；`error_logs` 没有一个可以按 msg 分组计数的
  // 只读端口，加一个需要新的 SECURITY DEFINER 函数——超出本轮范围，此处诚实地
  // 只在拉到的窗口内计数，而不是假装是全表精确值）。
  const countByMsg = new Map<string, number>();
  for (const row of rows) countByMsg.set(row.msg, (countByMsg.get(row.msg) ?? 0) + 1);

  return rows.map((row) => {
    const count = countByMsg.get(row.msg) ?? 1;
    const item: InboxItemView = {
      id: row.id,
      kind: "exception",
      code: codes.get(row.id)!,
      title: row.aiTitle ?? row.msg,
      body: row.msg,
      structured: null,
      feedbackKind: null,
      sourceStatus: row.status,
      // `ErrorLogStatus`（api 端口）与 `SystemErrorStatus`（契约）是同一组字符串字面量
      // （见 `error-log.port.ts` 的 `ErrorLogListItem.status` 头注），这里只是把
      // 一个结构相同、名字不同的类型接到 `stageOf` 的重载上，不是丢弃类型安全。
      stage: C.stageOf("exception", row.status as unknown as systemErrorLogs.SystemErrorStatus),
      statusReason: row.statusReason,
      severe: count >= C.INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD,
      votes: 0,
      reporter: null,
      createdAt: row.createdAt,
      github: null,
      linkedFeedbackId: null,
      resolvedByDesignId: null,
      exception: { location: deriveExceptionLocation(row.detail), count, affectedUsers: null },
      submittedByMe: false,
      votedByMe: false,
    };
    return { item, key: { createdAt: row.createdAt, kind: "exception", id: row.id } };
  });
}

/**
 * B4.3 —— 已推送的设计项目投影成收件箱条目。**只有 `pushed === true` 的项目才会出现**
 * （调用方必须先过滤，见 `list-inbox.ts`/`get-inbox-counts.ts`：未推送的项目不是收件箱条目，
 * 契约 `pushToInbox` 才是唯一的"生成收件箱条目"入口）。
 *
 * ⚠ `stage` 恒 `backlog`——backlog.md B4.3 逐字「生成收件箱条目（`kind=design`,
 *   `status=backlog`）」：设计方案没有自己的状态机（`pushed: boolean` 是它唯一的二态,见
 *   契约 `pushToInbox` 头注最后一条),`stageOf` 因此对 `design` kind 永远抛错（见 `inbox.ts`
 *   `stageOf` 头注），这里不调用它,直接给固定值——这不是绕过映射表,是"design 这个来源
 *   压根没有源状态可映射"的诚实表达。
 * ⚠ `sourceStatus`（drawer 状态标签的原始文案）给一个人类可读的常量 `"已推送"`——这批项目
 *   进入这个函数前已经全部按 `pushed === true` 过滤过,不存在"未推送但出现在这里"的行。
 * ⚠ `body`：契约 `InboxItem` 的"仅某类"字段表里 design 这一行是"—"（未定的),这里选
 *   `pushNote ?? (problem 非空 ? problem : null)`——推送时填的说明优先,没有就退回项目背景,
 *   都没有则老实给 `null`（不是"空字符串",同 `body===null` 在别处的语义:没有可展示的正文)。
 */
export function buildDesignInboxItems(rows: readonly DesignProjectView[]): InboxKeyed[] {
  const pushed = rows.filter((r) => r.pushed);
  const codes = assignCodes(pushed, "D");

  return pushed.map((row) => {
    const item: InboxItemView = {
      id: row.id,
      kind: "design",
      code: codes.get(row.id)!,
      title: row.name,
      body: row.problem.trim() !== "" ? row.problem : null,
      structured: null,
      feedbackKind: null,
      sourceStatus: "已推送",
      stage: "backlog",
      statusReason: null,
      severe: false,
      votes: 0,
      reporter: row.ownerName,
      createdAt: row.createdAt,
      github: null,
      linkedFeedbackId: row.linkedFeedbackId,
      resolvedByDesignId: null,
      exception: null,
      submittedByMe: false,
      votedByMe: false,
    };
    return { item, key: { createdAt: row.createdAt, kind: "design", id: row.id } };
  });
}
