import { describe, expect, it } from "vitest";
import {
  allReachableCardIds,
  assertNoCardLoss,
  GLOBAL_VIEW_COLUMNS,
  PROJECT_VIEW_COLUMNS,
  projectGlobalView,
  projectProjectView,
  type ProjectableCard,
} from "../../src/domain/board/card-projection";
import { TASK_STATUSES } from "../../src/domain/board/task-status";

/**
 * F02 -- uc-11-1 R3.1/R7/R12 V2/V3: "同一份任务表投影为项目内四列（折叠 inbox）与全局
 * 五列，两视图卡 ID 集合完全相同、无丢卡"。
 *
 * Pure domain test -- `card-projection.ts` takes an already-fetched list and does not
 * query anything, so this needs no database (same discipline as `transition-matrix.ts`).
 */
function cards(statuses: readonly string[]): ProjectableCard[] {
  return statuses.map((status, i) => ({ id: `card-${i}-${status}`, status: status as ProjectableCard["status"] }));
}

describe("F02 view projection: columns", () => {
  it("project view has exactly the 4 named columns, in order", () => {
    expect(PROJECT_VIEW_COLUMNS).toEqual(["todo", "in_progress", "review", "done"]);
  });
  it("global view has all 5 statuses, in the same natural order as TASK_STATUSES", () => {
    expect(GLOBAL_VIEW_COLUMNS).toEqual(TASK_STATUSES);
  });
});

describe("F02 AC2/V2/V3: no card loss across the two view projections", () => {
  it("one card per status: every card is reachable in BOTH views", () => {
    const all = cards(TASK_STATUSES);
    const { noCardLoss, projectView, globalView } = assertNoCardLoss(all);
    expect(noCardLoss).toBe(true);

    // The inbox card is NOT in any of the project view's 4 columns...
    const inboxCard = all.find((c) => c.status === "inbox")!;
    for (const col of projectView.columns) expect(col.cardIds).not.toContain(inboxCard.id);
    // ...but it IS reachable through the collapsed entry point (R4 A2 / R7: "不得因视图
    // 折叠而让这些卡无处可达").
    expect(projectView.collapsedInbox.cardIds).toContain(inboxCard.id);
    expect(projectView.collapsedInbox.count).toBe(1);

    // The global view shows it as an ordinary column member instead.
    const globalInboxColumn = globalView.columns.find((c) => c.status === "inbox")!;
    expect(globalInboxColumn.cardIds).toContain(inboxCard.id);
  });

  it("V2: two views' reachable card ID sets are IDENTICAL for a larger, mixed-status set", () => {
    const all = cards(["inbox", "inbox", "todo", "todo", "in_progress", "review", "done", "done", "done"]);
    const { projectView, globalView, noCardLoss } = assertNoCardLoss(all);
    expect(noCardLoss).toBe(true);

    const projectIds = allReachableCardIds(projectView);
    const globalIds = allReachableCardIds(globalView);
    expect([...projectIds].sort()).toEqual([...globalIds].sort());
    expect([...projectIds].sort()).toEqual(all.map((c) => c.id).sort());
  });

  it("V3: reachable card count in the project view (4 columns + collapsed entry) equals total", () => {
    const all = cards(["inbox", "inbox", "inbox", "todo", "done"]);
    const view = projectProjectView(all);
    const reachable = view.columns.reduce((n, c) => n + c.cardIds.length, 0) + view.collapsedInbox.count;
    expect(reachable).toBe(all.length);
  });

  it("an empty task set projects to empty columns on both views, not an error", () => {
    const { noCardLoss, projectView, globalView } = assertNoCardLoss([]);
    expect(noCardLoss).toBe(true);
    expect(projectView.collapsedInbox.count).toBe(0);
    for (const col of [...projectView.columns, ...globalView.columns]) expect(col.cardIds).toEqual([]);
  });

  it("global view never collapses inbox -- it is an ordinary column like the other four", () => {
    const all = cards(["inbox"]);
    const globalView = projectGlobalView(all);
    expect(globalView.columns.find((c) => c.status === "inbox")?.cardIds).toEqual([all[0]!.id]);
  });
});
