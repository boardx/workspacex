import { describe, expect, it } from "vitest";
import { decideUnload, explainBudget, memoryBudgetBytes } from "../src/model-memory-budget";

const GB = 1024 ** 3;

describe("预算怎么算", () => {
  it("16 GB 机器 + 3.8 GB 模型 ⇒ 5.6 GB", () => {
    const b = memoryBudgetBytes({ totalBytes: 16 * GB, freshBytes: 3.8 * GB });
    expect(b / GB).toBeCloseTo(5.6, 1);
  });

  it("小内存机器不会把预算压到模型刚加载完就超——否则会反复冷加载", () => {
    const fresh = 3.8 * GB;
    const b = memoryBudgetBytes({ totalBytes: 8 * GB, freshBytes: fresh });
    expect(b).toBeGreaterThan(fresh);
    expect(b / GB).toBeCloseTo(4.8, 1);            // 下界生效：3.8 + 1
  });

  it("大内存机器也不放任它涨——上限 8 GB", () => {
    expect(memoryBudgetBytes({ totalBytes: 128 * GB, freshBytes: 3.8 * GB })).toBe(8 * GB);
  });

  it("把式子本身说出来，不只是说「超了」", () => {
    const t = explainBudget({ totalBytes: 16 * GB, freshBytes: 3.8 * GB });
    expect(t).toContain("35%");
    expect(t).toContain("上限 8 GB");
  });
});

const base = { budgetBytes: 5.6 * GB, busy: false, now: 10_000_000, lastUnloadAt: null };

describe("该不该卸", () => {
  it("没超就不动", () => {
    expect(decideUnload({ ...base, currentBytes: 4 * GB }).action).toBe("keep");
  });

  it("超了就卸，并说清代价", () => {
    const d = decideUnload({ ...base, currentBytes: 9.7 * GB });
    expect(d.action).toBe("unload");
    if (d.action === "unload") {
      expect(d.reason).toContain("9.7 GB");
      expect(d.reason).toMatch(/多等约两秒/);       // 代价要说出来
    }
  });

  it("**生成中绝不卸**——把用户正在等的那句话掐掉比多占几个 GB 糟得多", () => {
    expect(decideUnload({ ...base, currentBytes: 20 * GB, busy: true }).action).toBe("keep");
  });

  it("刚卸过就别马上再卸，否则会陷入卸了又装的循环", () => {
    const d = decideUnload({ ...base, currentBytes: 20 * GB, lastUnloadAt: base.now - 1000 });
    expect(d.action).toBe("keep");
  });

  it("冷却过了才允许再卸", () => {
    const d = decideUnload({ ...base, currentBytes: 20 * GB, lastUnloadAt: base.now - 6 * 60_000 });
    expect(d.action).toBe("unload");
  });
});

import { idleMsFromExpiry, parsePs, RECENTLY_USED_MS } from "../src/model-memory-budget";

describe("读 /api/ps", () => {
  it("正常响应解得出名字、大小、到期时间", () => {
    const ms = parsePs({ models: [{ name: "qwen3.5:4b-mlx", size: 10083618816, expires_at: "2026-09-23T22:33:57Z" }] });
    expect(ms).toHaveLength(1);
    expect(ms[0]!.sizeBytes).toBe(10083618816);
  });
  it("形状不对就返回空，不猜", () => {
    expect(parsePs(null)).toEqual([]);
    expect(parsePs({ models: "nope" })).toEqual([]);
    expect(parsePs({ models: [{ name: 1, size: "x" }] })).toEqual([]);
  });
});

describe("从到期时间倒推空闲多久", () => {
  const keep = 30 * 60_000;
  const now = Date.parse("2026-09-23T12:00:00Z");
  it("刚用过 ⇒ 空闲接近 0", () => {
    const exp = new Date(now + keep).toISOString();
    expect(idleMsFromExpiry(exp, keep, now)).toBeCloseTo(0, -2);
  });
  it("十分钟没用 ⇒ 空闲十分钟", () => {
    const exp = new Date(now + keep - 10 * 60_000).toISOString();
    expect(idleMsFromExpiry(exp, keep, now)! / 60_000).toBeCloseTo(10, 1);
  });
  it("解析不出来返回 null——调用方必须当成「可能正忙」", () => {
    expect(idleMsFromExpiry(null, keep, now)).toBeNull();
    expect(idleMsFromExpiry("不是时间", keep, now)).toBeNull();
  });
  it("最近使用的阈值是两分钟，不是零——生成一句话本来就要几十秒", () => {
    expect(RECENTLY_USED_MS).toBeGreaterThanOrEqual(60_000);
  });
});
