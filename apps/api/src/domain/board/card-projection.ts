/**
 * F02 -- 看板两视图投影（uc-11-1 R3.1/R7/R12 V2/V3）。
 *
 * "同一份任务表投影为项目内四列（折叠 inbox）与全局五列，两视图卡 ID 集合完全相同、
 * 无丢卡" -- this file is that projection, as a pure function over an already-fetched
 * list of cards. It does NOT query anything; the caller (`list-tasks.ts`) fetches the
 * rows (permission-filtered) once and hands them here twice (or reuses one projection
 * to derive the other), which is what makes "两视图读同一张任务表" a structural fact
 * instead of a discipline two separate queries would have to maintain by hand.
 */
import { TASK_STATUSES, type TaskStatus } from "./task-status";

export interface ProjectableCard {
  readonly id: string;
  readonly status: TaskStatus;
}

/** The four project-view columns, in the order uc-11-1 R3.1 names them. */
export const PROJECT_VIEW_COLUMNS: readonly TaskStatus[] = ["todo", "in_progress", "review", "done"];

/** All five, for the global view -- literally `TASK_STATUSES`, not a second hand list. */
export const GLOBAL_VIEW_COLUMNS: readonly TaskStatus[] = TASK_STATUSES;

export interface ProjectViewColumn {
  readonly status: TaskStatus;
  readonly cardIds: readonly string[];
}

export interface ProjectView {
  readonly columns: readonly ProjectViewColumn[];
  /** `inbox` cards, reachable through the collapsed entry point (uc-11-1 R3.1/R7 -- "收件箱 N"). */
  readonly collapsedInbox: { readonly count: number; readonly cardIds: readonly string[] };
}

export interface GlobalView {
  readonly columns: readonly ProjectViewColumn[];
}

function columnsOf<T extends ProjectableCard>(
  cards: readonly T[],
  statuses: readonly TaskStatus[],
): ProjectViewColumn[] {
  return statuses.map((status) => ({
    status,
    cardIds: cards.filter((c) => c.status === status).map((c) => c.id),
  }));
}

/** 项目内视图：四列 + 折叠 inbox。 */
export function projectProjectView<T extends ProjectableCard>(cards: readonly T[]): ProjectView {
  const inboxCards = cards.filter((c) => c.status === "inbox");
  return {
    columns: columnsOf(cards, PROJECT_VIEW_COLUMNS),
    collapsedInbox: { count: inboxCards.length, cardIds: inboxCards.map((c) => c.id) },
  };
}

/** 全局视图：五列全显，inbox 不折叠。 */
export function projectGlobalView<T extends ProjectableCard>(cards: readonly T[]): GlobalView {
  return { columns: columnsOf(cards, GLOBAL_VIEW_COLUMNS) };
}

/** 从一个投影的 view 里收集全部可达卡片 ID（列 + 折叠入口）。 */
export function allReachableCardIds(view: ProjectView | GlobalView): Set<string> {
  const ids = new Set<string>();
  for (const col of view.columns) for (const id of col.cardIds) ids.add(id);
  if ("collapsedInbox" in view) for (const id of view.collapsedInbox.cardIds) ids.add(id);
  return ids;
}

/**
 * F02 的核心断言（`view-projection-no-card-loss.test.ts`）：两个视图的可达卡片 ID
 * 集合必须与源集合完全相同（AC2/V2/V3 -- 折叠只影响呈现，不影响可达性）。
 */
export function assertNoCardLoss<T extends ProjectableCard>(cards: readonly T[]): {
  readonly projectView: ProjectView;
  readonly globalView: GlobalView;
  readonly noCardLoss: boolean;
} {
  const projectView = projectProjectView(cards);
  const globalView = projectGlobalView(cards);
  const sourceIds = new Set(cards.map((c) => c.id));
  const projectIds = allReachableCardIds(projectView);
  const globalIds = allReachableCardIds(globalView);
  const sameAsSource = (s: Set<string>) => s.size === sourceIds.size && [...s].every((id) => sourceIds.has(id));
  return {
    projectView,
    globalView,
    noCardLoss: sameAsSource(projectIds) && sameAsSource(globalIds),
  };
}
