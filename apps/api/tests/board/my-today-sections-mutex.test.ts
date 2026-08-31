/**
 * F06 -- 「我的今天」四语义分区归属计算（uc-11-5 R3/R7/R12）。Pure domain test --
 * `computeMyTodaySections` takes an already-fetched card list + an injected clock, no
 * database, same discipline as `transition-matrix-o27.test.ts`.
 *
 * ## 范围收窄（如实记录，见 `my-today-sections.ts` 头注 / feature_list.json F06 notes）
 *
 * ①区的「R2/R3 待审批」子类（依赖 F07/F08）本次没有数据源，恒为空集，不在下面断言里
 * 编造；③区的"agent 运行中"用 `executor` 前缀 + `status===in_progress` 近似（没有真实
 * agent 运行时可查），E1/E5（依赖失败降级/超预算转区）因此也不在本次范围内。
 */
import { describe, expect, it } from "vitest";
import { computeMyTodaySections, type MyTodayCard } from "../../src/domain/board/my-today-sections";
import { board } from "@repo/contracts";

const MY_TODAY_SECTION_KEYS = board.MY_TODAY_SECTION_KEYS;

const ME = "u-me";
const NOW = new Date("2026-08-31T09:00:00.000Z");

function card(overrides: Partial<MyTodayCard> & { id: string }): MyTodayCard {
  return { status: "todo", ownerUserId: ME, executor: null, dueAt: null, waitingOn: null, ...overrides };
}

describe("F06 V1: four fixed section keys, always present, even all-empty", () => {
  it("keys are exactly the four D-29 names, in the fixed order", () => {
    expect(MY_TODAY_SECTION_KEYS).toEqual(["awaiting_my_judgment", "my_push_today", "ai_running_for_me", "waiting_on_others"]);
  });

  it("an account with zero relevant cards still gets all four keys back, as empty arrays", () => {
    const sections = computeMyTodaySections({ cards: [], userId: ME, now: NOW });
    expect(Object.keys(sections).sort()).toEqual([...MY_TODAY_SECTION_KEYS].sort());
    for (const key of MY_TODAY_SECTION_KEYS) expect(sections[key]).toEqual([]);
  });
});

describe("F06 V3: ② 今天该我推进 -- owner=我 且 (今天到期或已逾期) 且 status ∈ {todo, in_progress}", () => {
  it("of 4 todo cards due yesterday/today/tomorrow/next week, only the first two land in ②", () => {
    const cards: MyTodayCard[] = [
      card({ id: "c-yesterday", dueAt: "2026-08-30T09:00:00.000Z" }),
      card({ id: "c-today", dueAt: "2026-08-31T20:00:00.000Z" }),
      card({ id: "c-tomorrow", dueAt: "2026-09-01T09:00:00.000Z" }),
      card({ id: "c-next-week", dueAt: "2026-09-07T09:00:00.000Z" }),
    ];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect([...sections.my_push_today].sort()).toEqual(["c-today", "c-yesterday"].sort());
    expect(sections.awaiting_my_judgment).toEqual([]);
  });
});

describe("F06 V4/AC3 (D-39): ③ AI 正在替我跑 -- owner 仍是我，executor 是 agent", () => {
  it("an in_progress card with an agent executor and me as owner lands in ③, owner untouched", () => {
    const cards: MyTodayCard[] = [card({ id: "c-agent-run", status: "in_progress", executor: "agent:scout" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.ai_running_for_me).toEqual(["c-agent-run"]);
    // owner never changes -- computeMyTodaySections does not even have a field that could
    // hold an "owner is now the agent" mistake; this is enforced structurally upstream by
    // `card-render.ts`'s split, asserted again here at the section-membership level.
  });
});

describe("F06 V6/AC5: ④ 下一步轮到别人 -- waiting_on 非空", () => {
  it("a card with waitingOn set (and none of the higher-priority conditions) lands in ④", () => {
    const cards: MyTodayCard[] = [card({ id: "c-waiting", status: "done", waitingOn: "周宁" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.waiting_on_others).toEqual(["c-waiting"]);
  });

  it("an empty/whitespace-only waitingOn does NOT count as 'waiting on someone' -- no placeholder value", () => {
    const cards: MyTodayCard[] = [card({ id: "c-blank-waiting", status: "done", waitingOn: "   " })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.waiting_on_others).toEqual([]);
  });
});

describe("F06 V7/AC2: section mutual exclusion -- a card satisfying multiple conditions lands in exactly one section", () => {
  it("a card that is BOTH ① (status=review) and would-be-② (owner+due today) lands only in ①", () => {
    const cards: MyTodayCard[] = [
      card({ id: "c-both", status: "review", dueAt: "2026-08-31T08:00:00.000Z" }),
    ];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.awaiting_my_judgment).toEqual(["c-both"]);
    expect(sections.my_push_today).toEqual([]);

    // Card id appears exactly once across the WHOLE response.
    const allIds = [
      ...sections.awaiting_my_judgment, ...sections.my_push_today,
      ...sections.ai_running_for_me, ...sections.waiting_on_others,
    ];
    expect(allIds.filter((id) => id === "c-both")).toHaveLength(1);
  });

  it("priority order is strictly ①→②→③→④: an agent-run card that is ALSO overdue lands in ①, not ③, if status is review", () => {
    const cards: MyTodayCard[] = [
      card({ id: "c-review-agent", status: "review", executor: "agent:ledger", dueAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.awaiting_my_judgment).toEqual(["c-review-agent"]);
    expect(sections.ai_running_for_me).toEqual([]);
  });
});

describe("F06 V10/D-27: inbox 卡进 ①（等我接受），不进 ②，不计入 ② 计数", () => {
  it("an overdue inbox card owned by me lands in ①, never in ②", () => {
    const cards: MyTodayCard[] = [card({ id: "c-inbox", status: "inbox", dueAt: "2026-01-01T00:00:00.000Z" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(sections.awaiting_my_judgment).toEqual(["c-inbox"]);
    expect(sections.my_push_today).toEqual([]);
  });
});

describe("F06 R5: this view only shows cards where I am the owner", () => {
  it("a card owned by someone else never appears in any of my four sections, even if I am the executor", () => {
    const cards: MyTodayCard[] = [card({ id: "c-not-mine", ownerUserId: "u-someone-else", executor: ME, status: "review" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    const allIds = [
      ...sections.awaiting_my_judgment, ...sections.my_push_today,
      ...sections.ai_running_for_me, ...sections.waiting_on_others,
    ];
    expect(allIds).toEqual([]);
  });

  it("a card with no owner at all (unassigned) never appears in my sections", () => {
    const cards: MyTodayCard[] = [card({ id: "c-unowned", ownerUserId: null, status: "review" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(Object.values(sections).flat()).toEqual([]);
  });
});

describe("F06: a card matching none of the four conditions does not appear anywhere (not forced into a section)", () => {
  it("a done card, no waitingOn, owner=me, no agent executor -- renders nowhere", () => {
    const cards: MyTodayCard[] = [card({ id: "c-quietly-done", status: "done" })];
    const sections = computeMyTodaySections({ cards, userId: ME, now: NOW });
    expect(Object.values(sections).flat()).toEqual([]);
  });
});
