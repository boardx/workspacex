import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { board } from "@repo/contracts";
import { TASK_STATUSES, isTaskStatus, statusRank, type TaskStatus } from "../../src/domain/board/task-status";

/**
 * F01: "任一任务卡的 status 恒属于 {inbox, todo, in_progress, review, done}；不存在第六值也
 * 不存在视图专用状态" -- and it must be declared exactly ONCE (AGENTS.md: 同一事实不得声明
 * 在两处，已因此漂移五次).
 *
 * `@repo/contracts`'s `board.ts` is that one declaration; `domain/board/task-status.ts`
 * derives from it (same pattern as `identity/roles.ts` deriving `OrgRole`/`ProjectRole`).
 * This file asserts both the SHAPE (exactly these five, in this order) and the SOURCING
 * (domain re-exports rather than retyping, and nothing outside `board.ts`/`task-status.ts`
 * hand-writes the five-value array again).
 */

const EXPECTED: readonly string[] = ["inbox", "todo", "in_progress", "review", "done"];

describe("the five-state vocabulary is closed", () => {
  it("there are exactly five statuses, no sixth value", () => {
    expect(TASK_STATUSES).toHaveLength(5);
    expect([...TASK_STATUSES]).toEqual(EXPECTED);
  });

  it("the contract enum (single source) has the identical five values in the identical order", () => {
    expect(board.TaskStatus.options).toEqual(EXPECTED);
    // Domain re-exports the SAME array reference's values, not a retyped copy.
    expect([...TASK_STATUSES]).toEqual(board.TaskStatus.options);
  });

  it("isTaskStatus accepts only the five declared values", () => {
    for (const s of EXPECTED) expect(isTaskStatus(s)).toBe(true);
    for (const bogus of ["", "backlog", "blocked", "archived", "Done", "DONE", "in-progress", null, undefined, 42]) {
      expect(isTaskStatus(bogus), `unexpectedly accepted ${String(bogus)}`).toBe(false);
    }
  });

  it("there is no view-specific status: every rank is defined and unique, 0..4", () => {
    const ranks = EXPECTED.map((s) => statusRank(s as TaskStatus));
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(ranks).size).toBe(5);
  });

  it("zod rejects anything not in the five-value enum", () => {
    expect(board.TaskStatus.safeParse("inbox").success).toBe(true);
    expect(board.TaskStatus.safeParse("kanban-parking-lot").success).toBe(false);
    expect(board.TaskStatus.safeParse("").success).toBe(false);
  });
});

describe("the enum has exactly one home", () => {
  it("no second hand-authored five-value status array exists anywhere in apps/api/src", () => {
    // A second array with the same five literal strings, declared as a fresh array (not an
    // import of TASK_STATUSES/board.TaskStatus), is exactly how this project has drifted
    // five times before (design tokens / font-size tiers / discard-reason enum / withdrawal
    // SLA / point estimates). This walks the source tree and fails on a literal restatement
    // of the five-value array outside the two files that are allowed to hold it.
    const srcDir = fileURLToPath(new URL("../../src", import.meta.url));
    const allowed = new Set([
      join(srcDir, "domain", "board", "task-status.ts"),
    ]);
    const pattern = /\[\s*["']inbox["']\s*,\s*["']todo["']\s*,\s*["']in_progress["']\s*,\s*["']review["']\s*,\s*["']done["']\s*\]/;

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (/\.tsx?$/.test(name) && !allowed.has(p)) {
          if (pattern.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    walk(srcDir);
    expect(offenders, `second declaration of the five-state array:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no copy of it exists in the frontend either", () => {
    const webDir = fileURLToPath(new URL("../../../web", import.meta.url));
    if (!existsSync(webDir)) return;
    const pattern = /\[\s*["']inbox["']\s*,\s*["']todo["']\s*,\s*["']in_progress["']\s*,\s*["']review["']\s*,\s*["']done["']\s*\]/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (/\.tsx?$/.test(name) && pattern.test(readFileSync(p, "utf8"))) {
          offenders.push(p);
        }
      }
    };
    walk(webDir);
    expect(offenders, `frontend copy of the five-state array:\n${offenders.join("\n")}`).toEqual([]);
  });
});
