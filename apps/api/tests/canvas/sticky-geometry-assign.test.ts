/**
 * #1493（UC-7.3 第二块）—— `domain/canvas/sticky-geometry.ts` 的归区判定单测。
 *
 * 语义权威是引擎 `serializeTemplate` 内嵌的那套判定（包含 `<=` / 最近框严格 `<`）；
 * 本文件用引擎自己的 SWOT 四象限几何（`templates-strategy.ts`：优势 430,280 ·
 * 劣势 1190,280 · 机会 430,680 · 威胁 1190,680，各 740×380）钉住两边不漂移，
 * 并覆盖判定的三类边界：框边线上、等距两框、全部框外（I-10 全函数）。
 */
import { describe, expect, it } from "vitest";
import { assignStickyToBox, type SectionBox } from "../../src/domain/canvas/sticky-geometry";
import { getTemplate } from "@repo/fabric-markdown/templates";

const SWOT: readonly SectionBox[] = (() => {
  const spec = getTemplate("swot");
  if (!spec) throw new Error("swot 模板未注册 —— templates-entry 被破坏");
  return spec.sections.map((s) => ({ key: s.name, x: s.x, y: s.y, w: s.w, h: s.h }));
})();

describe("#1493 · assignStickyToBox：框内命中", () => {
  it("框中心命中该框，nearestFallback=false", () => {
    expect(assignStickyToBox({ x: 1190, y: 680 }, SWOT)).toEqual({
      key: "威胁", nearestFallback: false,
    });
  });

  it("边界：恰好落在框边线上（x = 中心 + w/2）按框内算（引擎 `<=` 同款）", () => {
    const box = SWOT.find((b) => b.key === "优势")!;
    const verdict = assignStickyToBox({ x: box.x + box.w / 2, y: box.y }, SWOT);
    expect(verdict).toEqual({ key: "优势", nearestFallback: false });
  });

  it("两框重叠时第一个声明的框赢（引擎 find 同款）", () => {
    const overlapping: SectionBox[] = [
      { key: "a", x: 0, y: 0, w: 100, h: 100 },
      { key: "b", x: 10, y: 0, w: 100, h: 100 },
    ];
    expect(assignStickyToBox({ x: 5, y: 0 }, overlapping)!.key).toBe("a");
  });
});

describe("#1493 · assignStickyToBox：框外最近兜底（E2d 的判定源）", () => {
  it("落在所有框外 ⇒ 归中心最近的框，nearestFallback=true", () => {
    // (0,0)：距优势中心 (430,280) 最近。
    expect(assignStickyToBox({ x: 0, y: 0 }, SWOT)).toEqual({
      key: "优势", nearestFallback: true,
    });
  });

  it("边界：与两个框中心等距 ⇒ 第一个声明的框赢（引擎严格 `<` 同款）", () => {
    // 优势 (430,280) 与劣势 (1190,280) 的中垂线 x=810；y 拉远保证不落在任何框内。
    const verdict = assignStickyToBox({ x: 810, y: 5000 }, SWOT);
    expect(verdict!.nearestFallback).toBe(true);
    // 等距的是机会 (430,680) 与威胁 (1190,680)——y=5000 离下排更近，两者等距，机会先声明。
    expect(verdict!.key).toBe("机会");
  });

  it("I-10 全函数：boxes 非空时任何点都有归属", () => {
    for (const p of [{ x: -1e6, y: -1e6 }, { x: 1e6, y: 0 }, { x: 810, y: 480 }]) {
      expect(assignStickyToBox(p, SWOT)).not.toBeNull();
    }
  });

  it("boxes 为空 ⇒ null（无几何模板的恒等映射由调用方处理，不是无归属便签）", () => {
    expect(assignStickyToBox({ x: 0, y: 0 }, [])).toBeNull();
  });
});
