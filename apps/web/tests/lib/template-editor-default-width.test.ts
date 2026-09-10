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
import { defaultLayoutAt, DEFAULT_BLOCK_SPAN } from "@/components/canvas/template-editor-model";

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
