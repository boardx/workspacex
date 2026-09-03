import { describe, expect, it } from "vitest";
import { decideTransition } from "../../src/domain/board/transition-matrix";
import { TASK_STATUSES } from "../../src/domain/board/task-status";

/**
 * O-27, transcribed verbatim from
 * `phases/phase-02-visible-outcomes/requirements/11-board/uc-11-1-四列看板与推进.md` R10.
 *
 * "✅" = allowed unconditionally, reason is irrelevant either way.
 * "📝" = allowed ONLY with a non-blank reason; blank/missing reason is rejected.
 * "⛔" = rejected unconditionally -- a reason does NOT buy passage (the whole inbox column).
 *
 * 5 x 5 = 25 ordered pairs; the diagonal (from === to) is not a cell of this table at all
 * ("--"), leaving exactly the 20 ordered pairs the feature spec calls for.
 */
type Cell = "✅" | "📝" | "⛔" | "--";

const MATRIX: Record<string, Record<string, Cell>> = {
  inbox: { inbox: "--", todo: "✅", in_progress: "✅", review: "✅", done: "✅" },
  todo: { inbox: "⛔", todo: "--", in_progress: "✅", review: "✅", done: "✅" },
  in_progress: { inbox: "⛔", todo: "📝", in_progress: "--", review: "✅", done: "✅" },
  review: { inbox: "⛔", todo: "📝", in_progress: "📝", review: "--", done: "✅" },
  done: { inbox: "⛔", todo: "📝", in_progress: "📝", review: "📝", done: "--" },
};

const REASON = "打回：漏了一个验收点，需要补充材料";
const BLANK_REASONS: ReadonlyArray<string | null | undefined> = ["", "   ", "\t\n", null, undefined];

describe("O-27: the matrix is 5x5, and the diagonal is not a cell of it", () => {
  it("every status has a row and a column", () => {
    for (const from of TASK_STATUSES) {
      expect(Object.keys(MATRIX[from]!).sort()).toEqual([...TASK_STATUSES].sort());
    }
    expect(Object.keys(MATRIX).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it("exactly 20 ordered (from, to) pairs are exercised below (5x5 minus the 5-cell diagonal)", () => {
    const pairs = TASK_STATUSES.flatMap((from) => TASK_STATUSES.filter((to) => to !== from).map((to) => [from, to]));
    expect(pairs).toHaveLength(20);
  });
});

describe("O-27: every one of the 20 ordered pairs, checked against the table exactly", () => {
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      if (to === from) continue;
      const cell = MATRIX[from]![to]!;

      if (cell === "✅") {
        it(`${from} -> ${to}: ✅ allowed unconditionally, no reason needed`, () => {
          expect(decideTransition(from, to)).toEqual({ allowed: true });
        });
        it(`${from} -> ${to}: ✅ still allowed even if a reason is (needlessly) supplied`, () => {
          expect(decideTransition(from, to, REASON)).toEqual({ allowed: true });
        });
      } else if (cell === "📝") {
        it(`${from} -> ${to}: 📝 allowed with a non-blank reason`, () => {
          expect(decideTransition(from, to, REASON)).toEqual({ allowed: true });
        });
        for (const blank of BLANK_REASONS) {
          it(`${from} -> ${to}: 📝 rejected when reason is ${JSON.stringify(blank)}`, () => {
            expect(decideTransition(from, to, blank)).toEqual({
              allowed: false,
              reasonCode: "REASON_REQUIRED",
            });
          });
        }
      } else if (cell === "⛔") {
        it(`${from} -> ${to}: ⛔ rejected even with no reason`, () => {
          expect(decideTransition(from, to)).toEqual({
            allowed: false,
            reasonCode: "INBOX_REENTRY_FORBIDDEN",
          });
        });
        it(`${from} -> ${to}: ⛔ rejected EVEN WITH a non-blank reason -- a reason does not buy passage into inbox`, () => {
          expect(decideTransition(from, to, REASON)).toEqual({
            allowed: false,
            reasonCode: "INBOX_REENTRY_FORBIDDEN",
          });
        });
      }
    }
  }
});

describe("O-27 rule 1: forward jumps skip columns freely", () => {
  it("todo -> done is a two-column jump, allowed unconditionally", () => {
    expect(decideTransition("todo", "done")).toEqual({ allowed: true });
  });
  it("inbox -> done is a four-column jump, allowed unconditionally", () => {
    expect(decideTransition("inbox", "done")).toEqual({ allowed: true });
  });
});

describe("O-27 rule 3: inbox is a one-way door, for every non-inbox origin", () => {
  it("nothing ever transitions back into inbox once it has left", () => {
    for (const from of TASK_STATUSES.filter((s) => s !== "inbox")) {
      expect(decideTransition(from, "inbox").allowed, from).toBe(false);
      expect(decideTransition(from, "inbox", REASON).allowed, `${from} with reason`).toBe(false);
    }
  });
});

describe("O-27 rule 4: scope=global forbids cross-project transitions", () => {
  it("an otherwise-legal forward move is rejected under global scope", () => {
    const d = decideTransition("todo", "in_progress", undefined, { sameProjectScope: false });
    expect(d).toEqual({ allowed: false, reasonCode: "GLOBAL_SCOPE_CROSS_PROJECT_FORBIDDEN" });
  });

  it("an otherwise-legal backward move WITH a valid reason is still rejected under global scope", () => {
    const d = decideTransition("done", "review", REASON, { sameProjectScope: false });
    expect(d).toEqual({ allowed: false, reasonCode: "GLOBAL_SCOPE_CROSS_PROJECT_FORBIDDEN" });
  });

  it("the same request succeeds once sameProjectScope is true (or omitted, the default)", () => {
    expect(decideTransition("todo", "in_progress", undefined, { sameProjectScope: true })).toEqual({
      allowed: true,
    });
    expect(decideTransition("todo", "in_progress")).toEqual({ allowed: true });
  });
});

describe("edge cases outside the 20-pair table", () => {
  it("a same-status 'transition' is rejected as a no-op, not silently accepted", () => {
    for (const s of TASK_STATUSES) {
      expect(decideTransition(s, s)).toEqual({ allowed: false, reasonCode: "NOOP_TRANSITION" });
    }
  });

  it("an unknown status on either side is rejected, never waved through", () => {
    expect(decideTransition("todo", "archived")).toEqual({ allowed: false, reasonCode: "UNKNOWN_STATUS" });
    expect(decideTransition("blocked", "done")).toEqual({ allowed: false, reasonCode: "UNKNOWN_STATUS" });
    expect(decideTransition("", "")).toEqual({ allowed: false, reasonCode: "UNKNOWN_STATUS" });
  });
});
