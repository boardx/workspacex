/**
 * F02 -- 看板列表查询用例：项目内四列视图 / 全局五列视图，三处计数（列计数 / 标签徽标 /
 * 底注逾期计数）来自同一次查询产出（uc-11-1 R3.1/R4/R7/R12 V2-V4）。
 */
import { assertNoCardLoss, type ProjectableCard } from "../../domain/board/card-projection";
import { renderCard, type RawTaskRow, type RenderedCard } from "../../domain/board/card-render";
import type { ProjectRole } from "../../domain/identity/roles";
import type { TaskRepository } from "./ports";
import type { DatabasePort } from "../ports/database.port";
import type { OrgId } from "../../domain/org-id";

export interface ListTasksDeps {
  readonly db: DatabasePort;
  readonly tasks: TaskRepository;
}

export interface ListTasksInput {
  readonly orgId: OrgId;
  readonly userId: string;
  readonly scope: "project" | "global";
  /** Required when `scope === "project"`. */
  readonly projectId?: string;
  readonly role: ProjectRole | "org-wide-admin";
  readonly groupId: string | null;
  /** "now" for the overdue/今天到期 footer counts -- injected, not `new Date()`, so this
   *  use case stays testable without wall-clock flakiness (same discipline as
   *  `my-today-sections.ts`). */
  readonly now: Date;
}

export interface FooterCounts {
  readonly overdue: number;
  readonly dueToday: number;
}

export interface ListTasksOutput {
  readonly cards: readonly RenderedCard[];
  readonly scope: "project" | "global";
  /** Column key -> card ids, in the view's own column order. Project view has 4 (inbox
   *  collapsed into `collapsedInboxCount`); global view has 5. */
  readonly columns: readonly { readonly status: string; readonly cardIds: readonly string[] }[];
  readonly collapsedInboxCount: number;
  /** "待办 N" 标签徽标——未完成（不含 done，不含 inbox，D-26 R7）数。 */
  readonly badgeCount: number;
  readonly footer: FooterCounts;
  /** F02 断言用：两视图可达卡片 ID 与源集合完全一致。 */
  readonly noCardLoss: boolean;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export async function listTasks(deps: ListTasksDeps, input: ListTasksInput): Promise<ListTasksOutput> {
  const projectIds = input.scope === "project" ? (input.projectId ? [input.projectId] : []) : null;

  const rows: readonly RawTaskRow[] = await deps.db.withTenant(input.orgId, (session) =>
    deps.tasks.listVisibleWithin(session, {
      orgId: input.orgId,
      userId: input.userId,
      projectIds,
      role: input.role,
      groupId: input.groupId,
    }));

  const cards = rows.map(renderCard);

  const projectable: ProjectableCard[] = cards.map((c) => ({ id: c.id, status: c.status }));
  const { projectView, globalView, noCardLoss } = assertNoCardLoss(projectable);
  const view = input.scope === "project" ? projectView : globalView;
  const collapsedInboxCount = input.scope === "project" ? projectView.collapsedInbox.count : 0;

  // 同一份 cards 产出全部三处计数——不是三次独立统计。
  const badgeCount = cards.filter((c) => c.status !== "done" && c.status !== "inbox").length;
  let overdue = 0;
  let dueToday = 0;
  for (const c of cards) {
    if (c.dueAt === null || c.status === "done") continue;
    const due = new Date(c.dueAt);
    if (Number.isNaN(due.getTime())) continue;
    if (due.getTime() < input.now.getTime() && !isSameCalendarDay(due, input.now)) overdue += 1;
    else if (isSameCalendarDay(due, input.now)) dueToday += 1;
  }

  return {
    cards,
    scope: input.scope,
    columns: view.columns.map((col) => ({ status: col.status, cardIds: col.cardIds })),
    collapsedInboxCount,
    badgeCount,
    footer: { overdue, dueToday },
    noCardLoss,
  };
}
