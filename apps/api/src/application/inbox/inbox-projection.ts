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
import { boardOrderKey as boardOrderKeyOf, defaultBoardOrder } from "../../domain/inbox/board-order";

/** 见 `list-inbox.ts` 文件头「分页的取舍」——单次聚合最多从 `error_logs` 拉这么多行。 */
export const INBOX_EXCEPTION_FETCH_CAP = 2000;
const EXCEPTION_FETCH_PAGE = 200;

/**
 * 拉全部（受 `INBOX_EXCEPTION_FETCH_CAP` 约束）系统异常行，供 `listInbox` 与
 * `getInboxCounts` 共用——两个用例都需要"参与排序/计数的完整窗口"，不是各自
 * 分页一次。
 *
 * `capHit`（UC-17.8 B6.4）：拉满上限时源头还有更多行 —— 这正是 `list-inbox.ts` 文件头
 * 「已知取舍」里那条"每次请求重新拉两个源再排序"的取舍**开始撒谎**的时刻（超出上限的
 * 异常不在收件箱里，且没有任何界面提示）。值班要能从日志里看到它，而不是等有人发现
 * 「E-2001 去哪了」。判定放在这里而不是调用方：只有这个循环知道自己是因为上限还是因为
 * `hasMore=false` 停下来的。
 */
export async function fetchAllExceptions(
  errorLog: ErrorLogPort,
): Promise<{ readonly items: readonly ErrorLogListItem[]; readonly capHit: boolean }> {
  const items: ErrorLogListItem[] = [];
  let beforeId: string | null = null;
  let hasMore = false;
  for (let i = 0; i < INBOX_EXCEPTION_FETCH_CAP / EXCEPTION_FETCH_PAGE; i += 1) {
    const page = await errorLog.list({ limit: EXCEPTION_FETCH_PAGE, beforeId });
    items.push(...page.items);
    hasMore = page.hasMore && page.items.length > 0;
    if (!hasMore) break;
    beforeId = page.items[page.items.length - 1]?.id ?? null;
  }
  return { items, capHit: hasMore };
}

export type InboxItemView = z.infer<typeof C.InboxItem>;

/**
 * 把落库的排序值合并进 `InboxItem.boardOrder`（`listInbox`/`getInboxCounts` 共用，
 * 同一事实不得声明在两处）。**没有存过值的条目**回退到 `defaultBoardOrder`——
 * 与现有「按 `createdAt` 倒序」的顺序保持连续，见该函数头注。
 */
export function applyBoardOrder(
  keyed: readonly InboxKeyed[],
  orders: ReadonlyMap<string, number>,
): InboxKeyed[] {
  return keyed.map(({ item, key }) => {
    const stored = orders.get(boardOrderKeyOf(item.kind, item.id));
    const boardOrder = stored ?? defaultBoardOrder(item.createdAt);
    return { item: { ...item, boardOrder }, key };
  });
}

/**
 * 2026-09-08——把侧表 `inbox_item_tags` 的标签合并进反馈 / 设计方案条目的 `tags`
 * （系统异常的 `tags` 已在 `buildExceptionInboxItems` 里从源行带出，这里**不碰**——
 * 见契约 `InboxItem` 头注「`tags`」：两个来源、两处存储、一个投影字段）。
 */
export function applyTags(
  keyed: readonly InboxKeyed[],
  tags: ReadonlyMap<string, readonly string[]>,
): InboxKeyed[] {
  return keyed.map(({ item, key }) => {
    if (item.kind === "exception") return { item, key };
    const stored = tags.get(boardOrderKeyOf(item.kind, item.id));
    return { item: { ...item, tags: stored === undefined ? [] : [...stored] }, key };
  });
}

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
  // 已归档只能从「已修复」/「不做」进入（见 domain ALLOWED_TRANSITIONS），
  // 挂着的 GitHub issue 早已在那一步关闭——这里跟着算作 closed。
  const closed = row.status === "已修复" || row.status === "不做" || row.status === "已归档";
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
      // 与 `body` 同一条 D3 门控——`listFeedback` 已经对无权行投影成 `[]`，这里原样透传。
      attachments: row.attachments,
      linkedFeedbackId: null,
      // UC-17.8 B4——真读列，见契约 `FeedbackItem.resolvedByDesignId` 头注。
      resolvedByDesignId: row.resolvedByDesignId,
      exception: null,
      submittedByMe: row.submittedByMe,
      votedByMe: row.votedByMe,
      // 占位——真实值由 `list-inbox.ts`/`get-inbox-counts.ts` 用 `InboxOrderRepository`
      // 的结果覆盖（见 `applyBoardOrder`）。这里必须先给一个数字满足 `.strict()` 形状。
      boardOrder: 0,
      tags: [], // 占位——真实值由 `applyTags` 从侧表合并。
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
  // 2026-09-08——同一条 `msg` 只显示一条（契约 `InboxExceptionMeta` 头注「同一异常只显示一条」）：
  // 按 `msg` 分组，代表行 = 组内最早的一行（id/code/状态/标签/排序值因此稳定），其余行只贡献
  // `count` / `lastSeenAt` / `occurrences`。计数仍是 `INBOX_EXCEPTION_FETCH_CAP` 窗口内的精确值
  // （见 `list-inbox.ts` 文件头「分页的取舍」：`error_logs` 没有按 msg 分组计数的只读端口）。
  const groups = new Map<string, ErrorLogListItem[]>();
  for (const row of rows) {
    const g = groups.get(row.msg);
    if (g === undefined) groups.set(row.msg, [row]);
    else g.push(row);
  }
  const representatives: { row: ErrorLogListItem; occurrences: string[] }[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort(compareCreatedAsc);
    const representative = sorted[0]!;
    const occurrences = sorted.map((r) => r.createdAt).reverse().slice(0, C.INBOX_EXCEPTION_OCCURRENCES_LIMIT);
    representatives.push({ row: representative, occurrences: occurrences.length === 0 ? [representative.createdAt] : occurrences });
  }
  // 编号在**折叠后**的代表行上连续赋值（E-1..E-n），不给被折叠的重复行留空号。
  const codes = assignCodes(representatives.map((r) => r.row), "E");

  return representatives.map(({ row, occurrences }) => {
    const count = groups.get(row.msg)?.length ?? 1;
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
      attachments: [],
      linkedFeedbackId: null,
      resolvedByDesignId: null,
      // `devNote` 原样透传源行（见契约 `InboxExceptionMeta` 头注「2026-09-05 补投影」）：
      // 写路径仍然只有 `updateSystemErrorLifecycle` 一条。
      exception: {
        location: deriveExceptionLocation(row.detail),
        count,
        affectedUsers: null,
        devNote: row.devNote,
        lastSeenAt: occurrences[0]!,
        occurrences,
      },
      submittedByMe: false,
      votedByMe: false,
      boardOrder: 0, // 占位，见 `buildFeedbackInboxItems` 同名字段注释。
      // 系统异常的标签住在源行 `error_logs.tags`——这里直接带出，`applyTags` 不覆盖它。
      tags: [...row.tags],
    };
    return { item, key: { createdAt: row.createdAt, kind: "exception", id: row.id } };
  });
}

/**
 * B4.3 —— 已推送的设计项目投影成收件箱条目。**只有 `pushed === true` 的项目才会出现**
 * （调用方必须先过滤，见 `list-inbox.ts`/`get-inbox-counts.ts`：未推送的项目不是收件箱条目，
 * 契约 `pushToInbox` 才是唯一的"生成收件箱条目"入口）。
 *
 * ⚠ `stage` 由 `designStageOf` 从「有没有 GitHub issue」派生（2026-09-05「转开发」之前
 *   这里是硬编的 `backlog`）：设计方案仍然没有源状态列，`stageOf` 对 `design` kind 依旧
 *   永远抛错——派生的输入是 issue 而不是某个 `status` 字符串，所以它是契约里另一个函数
 *   （`designStageOf`），不是这张映射表的一行。规则与「为什么没有 done」见那个函数头注。
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
    // 「有没有 issue」判一次，`github` / `stage` / `sourceStatus` 三处都读它——
    // 两列同生同灭（契约 `DesignProject.githubIssueUrl` 头注），但只有在这里合成一个值，
    // 才能保证万一出现半状态（只有 url 或只有 number）时三者不会各说各话：
    // 徽标为 null 而 stage 却说 `doing`，看板上就会出现一张「已转开发但没有票」的卡片。
    // `state` 恒 `open`——如实标注的近似值，理由见契约 `InboxGithubRef` 头注设计方案那一条
    // （没有对账来源能告诉我们这张 issue 关没关）。
    const issue: z.infer<typeof C.InboxGithubRef> | null =
      row.githubIssueUrl === null || row.githubIssueNumber === null
        ? null
        : { kind: "issue", number: row.githubIssueNumber, url: row.githubIssueUrl, state: "open" };
    const item: InboxItemView = {
      id: row.id,
      kind: "design",
      code: codes.get(row.id)!,
      title: row.name,
      body: row.problem.trim() !== "" ? row.problem : null,
      structured: null,
      feedbackKind: null,
      sourceStatus: issue === null ? "已推送" : "已转开发",
      stage: C.designStageOf({ githubIssueNumber: issue === null ? null : issue.number }),
      statusReason: null,
      severe: false,
      votes: 0,
      reporter: row.ownerName,
      createdAt: row.createdAt,
      github: issue,
      attachments: [],
      linkedFeedbackId: row.linkedFeedbackId,
      resolvedByDesignId: null,
      exception: null,
      submittedByMe: false,
      votedByMe: false,
      boardOrder: 0, // 占位，见 `buildFeedbackInboxItems` 同名字段注释。
      tags: [], // 占位，同上。
    };
    return { item, key: { createdAt: row.createdAt, kind: "design", id: row.id } };
  });
}
