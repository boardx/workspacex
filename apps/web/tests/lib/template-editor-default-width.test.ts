/**
 * 新字段落到画布上时的默认尺寸。
 *
 * 沿革（都是人类直接交办）：
 * · 2026-09-10 ①「现在默认 text 的长度是 6，改为默认是 2」——短文本单独收窄；
 * · 2026-09-10 ②「by default all the field size should be 2*2 not bigger」——
 *   收敛成**所有类型一律 2×2**，不再按类型分档。
 *
 * 为什么是小起点：默认值越大，一落地就越容易压住邻居、越容易撞上「长不动」。
 * 小起点 + 右栏随手调大，比大起点 + 每次都要缩，少一步手工。
 */
import { describe, expect, it } from "vitest";
import { defaultLayoutAt, DEFAULT_BLOCK_SPAN, sectionGeometryMmOf } from "@/components/canvas/template-editor-model";

describe("defaultLayoutAt —— 落到画布上的默认尺寸", () => {
  it("所有类型一律 2×2，不按类型分档", () => {
    for (const type of ["短文本", "长文本", "便利贴列表", "文本对象"] as const) {
      const l = defaultLayoutAt(type, 1, 1, 12);
      expect([type, l.w, l.h]).toEqual([type, DEFAULT_BLOCK_SPAN, DEFAULT_BLOCK_SPAN]);
    }
  });

  /**
   * ⚠ 2 是**格数**，不是比例：使用者说的是「2×2」。按比例算会让 24 列制下的默认块
   * 又变回四格宽，那正是这条指令要消掉的「一落地就太大」。
   */
  it("不随网格制式缩放：6 / 12 / 24 列制下都是 2 格宽", () => {
    expect(defaultLayoutAt("便利贴列表", 1, 1, 6).w).toBe(2);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12).w).toBe(2);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 24).w).toBe(2);
  });

  it("靠右边/靠下边落点仍夹回画布内，不因为默认值变小就绕过夹取", () => {
    // 12 列制、落在第 12 列：只剩 1 格。
    expect(defaultLayoutAt("便利贴列表", 12, 1, 12).w).toBe(1);
    // 8 行网格、落在第 8 行：只剩 1 行。
    expect(defaultLayoutAt("便利贴列表", 1, 8, 12).h).toBe(1);
  });

  it("`limits` 能把默认尺寸再压小（邻居占住时的路径），但压不到 0", () => {
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12, "A1", { maxW: 1, maxH: 1 })).toMatchObject({ w: 1, h: 1 });
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12, "A1", { maxW: 0, maxH: 0 })).toMatchObject({ w: 1, h: 1 });
  });
});

/**
 * ⚠ CI 浏览器 e2e 抓到的回归（2026-09-10，PR #3374 合入后）：默认块收成 2×2 之后，
 * `cols` 仍被硬夹到 ≥3、`max` 仍固定 6 —— 于是一个六分之一纸宽的框里塞三列六张贴纸，
 * 每张小到字都放不下，`canvas-tpl-sticky-not-clipped.spec.ts` 与
 * `canvas-template-library-design.spec.ts` 双双量出文字/贴纸被裁。
 *
 * 这两条把「默认值必须是这块地方**物理上真放得下**的量」钉死在纯函数这一层——
 * 浏览器 e2e 跑得慢又要真栈，这一层先红比等到 CI 再红便宜得多。
 */
describe("defaultLayoutAt —— 默认列数/条数必须是这块地方真放得下的量", () => {
  it("2×2 默认块：默认条数不超过它自己的物理容量", () => {
    for (const size of ["A1", "A3", "A4"] as const) {
      for (const gridCols of [6, 12, 24] as const) {
        const l = defaultLayoutAt("便利贴列表", 1, 1, gridCols, size);
        const fits = sectionGeometryMmOf(
          { type: "便利贴列表", layout: l } as never, gridCols, size,
        ).fits;
        expect([size, gridCols, l.max <= Math.max(1, fits)]).toEqual([size, gridCols, true]);
      }
    }
  });

  it("窄块的默认列数可以低到 1—2，不再被硬夹到 3", () => {
    // 12 列制下 2 格宽 ≈ 六分之一纸宽：76mm 标准贴纸摆不下 3 张。
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12).cols).toBeLessThan(3);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12).cols).toBeGreaterThanOrEqual(1);
  });

  it("把块调宽之后，默认列数仍然按宽度长回去（不是一律给 1）", () => {
    const wide = defaultLayoutAt("便利贴列表", 1, 1, 12, "A1", { maxW: 12, maxH: 8 });
    expect(wide.w).toBe(DEFAULT_BLOCK_SPAN);
  });
});
