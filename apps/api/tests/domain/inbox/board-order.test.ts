/**
 * `board-order.ts` 的领域规则单测——纯函数，无 IO。
 */
import { describe, expect, it } from "vitest";
import { assignBoardOrders, boardOrderKey, defaultBoardOrder, type BoardOrderEntry } from "../../../src/domain/inbox/board-order";

describe("assignBoardOrders", () => {
  it("按数组顺序赋 0..n-1", () => {
    const entries: BoardOrderEntry[] = [
      { kind: "feedback", id: "a" },
      { kind: "feedback", id: "b" },
      { kind: "exception", id: "c" },
    ];
    const out = assignBoardOrders(entries);
    expect(out.get(boardOrderKey("feedback", "a"))).toBe(0);
    expect(out.get(boardOrderKey("feedback", "b"))).toBe(1);
    expect(out.get(boardOrderKey("exception", "c"))).toBe(2);
  });

  it("去重：同一个 (kind,id) 第二次出现被丢弃，位置以第一次为准", () => {
    const entries: BoardOrderEntry[] = [
      { kind: "feedback", id: "a" },
      { kind: "feedback", id: "b" },
      { kind: "feedback", id: "a" }, // 重复
    ];
    const out = assignBoardOrders(entries);
    expect(out.size).toBe(2);
    expect(out.get(boardOrderKey("feedback", "a"))).toBe(0);
    expect(out.get(boardOrderKey("feedback", "b"))).toBe(1);
  });

  it("空数组回空 Map", () => {
    expect(assignBoardOrders([]).size).toBe(0);
  });

  it("不同 kind 相同 id 是不同的键（不会互相覆盖）", () => {
    const entries: BoardOrderEntry[] = [
      { kind: "feedback", id: "x" },
      { kind: "exception", id: "x" },
    ];
    const out = assignBoardOrders(entries);
    expect(out.size).toBe(2);
    expect(out.get(boardOrderKey("feedback", "x"))).toBe(0);
    expect(out.get(boardOrderKey("exception", "x"))).toBe(1);
  });
});

describe("defaultBoardOrder", () => {
  it("越新的 createdAt 得到越小（越靠前）的默认序", () => {
    const older = defaultBoardOrder("2026-09-01T00:00:00.000Z");
    const newer = defaultBoardOrder("2026-09-05T00:00:00.000Z");
    expect(newer).toBeLessThan(older);
  });
});
