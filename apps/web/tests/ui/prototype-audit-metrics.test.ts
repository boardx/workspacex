import { describe, expect, it } from "vitest";
import {
  contentFillRatio, scoreFill, scoreClipping, scoreTypeScale, scoreAlignment, machineScore,
} from "../../scripts/lib/prototype-audit-metrics.mjs";

/**
 * 原型截图审计的机器硬判——每条指标两个方向都断言。
 *
 * ⚠ 一条永远给高分的指标等于没有这条指标。所以每条都配一个**会低分的坏样本**，
 * 而且坏样本不是编的：它们逐条对应 2026-09-09 人类那张截图里真实存在的毛病。
 */

const node = (over: Partial<Record<string, unknown>> = {}) => ({
  x: 0, y: 0, w: 100, h: 20, fontSize: 12, clipped: false, tag: "div", ...over,
});

describe("M1 内容占比 —— 专治「移动端内容塞进笔记本画板」", () => {
  it("内容铺满画板 ⇒ 满分", () => {
    const s = { frame: { w: 400, h: 800 }, nodes: [node({ w: 400, h: 800 })] };
    expect(contentFillRatio(s)).toBeCloseTo(1, 5);
    expect(scoreFill(s).score).toBe(100);
  });

  /** 用户截图的真实形状：393×852 的内容摆在 1280×800 的画板里。 */
  it("移动端内容塞进笔记本画板 ⇒ 重伤，且理由点名画板尺寸", () => {
    const s = { frame: { w: 1280, h: 800 }, nodes: [node({ w: 393, h: 180 })] };
    const r = scoreFill(s);
    expect(r.score).toBeLessThan(20);
    expect(r.note).toContain("画板尺寸");
  });

  /** 空集防线：量不到东西一律判 0，不许因为「没发现问题」而判绿。 */
  it("画板或内容为空 ⇒ 判 0，拒绝下判断", () => {
    expect(scoreFill({ frame: { w: 0, h: 0 }, nodes: [] }).score).toBe(0);
    expect(scoreFill({ frame: { w: 400, h: 800 }, nodes: [] }).score).toBe(0);
  });
});

describe("M2 溢出裁切", () => {
  it("没有裁切 ⇒ 满分", () => {
    expect(scoreClipping({ frame: { w: 400, h: 800 }, nodes: [node(), node()] }).score).toBe(100);
  });
  it("图层面板文字被切掉那种 ⇒ 扣分，且数得出几处", () => {
    const s = { frame: { w: 400, h: 800 }, nodes: [node({ clipped: true }), node({ clipped: true }), node()] };
    expect(scoreClipping(s).score).toBe(50);
    expect(scoreClipping(s).note).toContain("2 处");
  });
  it("没有节点 ⇒ 判 0，拒绝下判断", () => {
    expect(scoreClipping({ frame: { w: 400, h: 800 }, nodes: [] }).score).toBe(0);
  });
});

describe("M3 字号层次", () => {
  it("标题正文辅助三档 ⇒ 满分", () => {
    const s = { frame: { w: 400, h: 800 }, nodes: [node({ fontSize: 20 }), node({ fontSize: 14 }), node({ fontSize: 11 })] };
    expect(scoreTypeScale(s).score).toBe(100);
  });
  it("全篇一个字号 ⇒ 低分，且说破「没有层次」", () => {
    const s = { frame: { w: 400, h: 800 }, nodes: [node({ fontSize: 12 }), node({ fontSize: 12 }), node({ fontSize: 12 })] };
    expect(scoreTypeScale(s).score).toBeLessThan(50);
    expect(scoreTypeScale(s).note).toContain("没有层次");
  });
  it("档位太碎（9 档）⇒ 扣分", () => {
    const nodes = [10, 11, 12, 13, 14, 15, 16, 17, 18].map((fontSize) => node({ fontSize }));
    expect(scoreTypeScale({ frame: { w: 400, h: 800 }, nodes }).score).toBeLessThan(100);
  });
});

describe("M4 对齐轴", () => {
  it("都对齐到两条轴 ⇒ 满分", () => {
    const nodes = [0, 0, 0, 24, 24, 24].map((x) => node({ x }));
    expect(scoreAlignment({ frame: { w: 400, h: 800 }, nodes }).score).toBe(100);
  });
  it("每个元素各在一个位置 ⇒ 低分", () => {
    const nodes = [0, 7, 15, 23, 31, 44].map((x) => node({ x }));
    expect(scoreAlignment({ frame: { w: 400, h: 800 }, nodes }).score).toBeLessThan(30);
  });
  it("容差 2px：子像素抖动不算新轴", () => {
    const nodes = [0, 1, 2, 40, 41, 42].map((x) => node({ x }));
    expect(scoreAlignment({ frame: { w: 400, h: 800 }, nodes }).score).toBe(100);
  });
});

describe("总分", () => {
  it("四条都好 ⇒ 过 80 分门", () => {
    const nodes = [
      node({ x: 16, y: 0, w: 360, h: 40, fontSize: 20 }),
      node({ x: 16, y: 48, w: 360, h: 300, fontSize: 14 }),
      node({ x: 16, y: 360, w: 360, h: 400, fontSize: 11 }),
    ];
    expect(machineScore({ frame: { w: 393, h: 800 }, nodes }).total).toBeGreaterThanOrEqual(80);
  });

  /**
   * ⚠ 这条是整个门控的验收：用户那张截图的形状**必须**判不及格。
   * 判它及格，这道门就是装饰。
   */
  it("用户 2026-09-09 那张截图的形状 ⇒ 判不及格", () => {
    const nodes = [
      node({ x: 12, y: 8, w: 150, h: 16, fontSize: 12 }),
      node({ x: 19, y: 30, w: 300, h: 16, fontSize: 12 }),
      node({ x: 27, y: 52, w: 420, h: 16, fontSize: 12, clipped: true }),
      node({ x: 33, y: 74, w: 380, h: 16, fontSize: 12 }),
    ];
    const r = machineScore({ frame: { w: 1280, h: 800 }, nodes });
    expect(r.total).toBeLessThan(80);
    expect(r.parts.fill.score).toBeLessThan(20);
  });
});

/**
 * 采集侧的 `clipped` 判据（`measureInPage`）——两个方向都断言。
 * ⚠ 这条是首跑误报逼出来的：带省略号的图层名被判成缺陷，门红在一个不存在的问题上。
 * 判据现在是「溢出 **且** 没有省略号」。
 */
describe("clipped 判据：省略号是告知，不是缺陷", () => {
  const isClipped = (el: { scrollWidth: number; clientWidth: number; textOverflow: string }) =>
    el.scrollWidth > el.clientWidth + 1 && el.textOverflow !== "ellipsis";

  it("溢出但给了省略号 ⇒ 不算缺陷", () => {
    expect(isClipped({ scrollWidth: 227, clientWidth: 195, textOverflow: "ellipsis" })).toBe(false);
  });
  it("溢出且没有任何提示 ⇒ 算缺陷", () => {
    expect(isClipped({ scrollWidth: 227, clientWidth: 195, textOverflow: "clip" })).toBe(true);
  });
  it("没溢出 ⇒ 不算缺陷（1px 容差躲子像素）", () => {
    expect(isClipped({ scrollWidth: 196, clientWidth: 195, textOverflow: "clip" })).toBe(false);
  });
});
