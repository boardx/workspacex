import { describe, expect, it } from "vitest";
import {
  computeQuarantineUntil,
  quarantineDaysRemaining,
  isQuarantineExpired,
} from "../../src/domain/mcp/quarantine";

/**
 * F131 (UC-21.1 R3 步骤 3 补 / I-30′) -- 隔离期计时：`quarantineUntil` 是时间戳而不是布尔。
 *
 * 布尔答不了「还剩几天」「到期了没有」，而这两件事界面上都要显示、待办里都要用——
 * 这份文件把这句话变成可执行断言：从同一个时间戳既能读出剩余天数，也能读出是否已到期。
 */

describe("F131 · computeQuarantineUntil -- 隔离期截止时刻 = 注册时刻 + 隔离期天数", () => {
  it("14 天参数：截止时刻是注册时刻之后整整 14 天", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    expect(until).toBe("2026-08-15T00:00:00.000Z");
  });

  it("产出的是 ISO 字符串（时间戳），不是布尔", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    expect(typeof until).toBe("string");
    expect(() => new Date(until).toISOString()).not.toThrow();
  });

  it("反证：非正整数天数必须显式报错，不能悄悄算出一个负的截止时刻", () => {
    expect(() => computeQuarantineUntil(new Date(), 0)).toThrow();
    expect(() => computeQuarantineUntil(new Date(), -1)).toThrow();
    expect(() => computeQuarantineUntil(new Date(), 1.5)).toThrow();
  });
});

describe("F131 · quarantineDaysRemaining -- 界面「隔离期还剩 N 天」的唯一算法", () => {
  it("注册后第 1 天：还剩 13 天", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    const remaining = quarantineDaysRemaining(until, new Date("2026-08-02T00:00:00Z"));
    expect(remaining).toBe(13);
  });

  it("向上取整：只剩几小时也算「还剩 1 天」，不能显示 0 天却仍在挡调用", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    const remaining = quarantineDaysRemaining(until, new Date("2026-08-14T18:00:00Z"));
    expect(remaining).toBe(1);
  });

  it("已过期钳为 0，不是负数", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    const remaining = quarantineDaysRemaining(until, new Date("2026-09-01T00:00:00Z"));
    expect(remaining).toBe(0);
  });

  it("`quarantineUntil === null`（非第三方源 / 未进入隔离期）返回 null，与「已到期」区分开", () => {
    expect(quarantineDaysRemaining(null, new Date("2026-08-02T00:00:00Z"))).toBeNull();
  });
});

describe("F131 · isQuarantineExpired -- 到期了没有", () => {
  it("截止时刻之前：未到期", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    expect(isQuarantineExpired(until, new Date("2026-08-10T00:00:00Z"))).toBe(false);
  });

  it("截止时刻恰好 / 之后：已到期", () => {
    const until = computeQuarantineUntil(new Date("2026-08-01T00:00:00Z"), 14);
    expect(isQuarantineExpired(until, new Date(until))).toBe(true);
    expect(isQuarantineExpired(until, new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });

  it("`quarantineUntil === null` 恒为 false —— 不是「隔离期已经过去」的记法", () => {
    expect(isQuarantineExpired(null, new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });
});
