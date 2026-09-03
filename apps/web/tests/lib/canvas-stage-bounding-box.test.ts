// @vitest-environment jsdom
/**
 * `unionBoundingBox` 的确定性几何单测——`exportPNG` 与 `fitToContent` 唯一共用的
 * 并集包围盒计算（`canvas-stage.tsx`，见该函数头注）。
 *
 * 用真实 fabric `Rect`/`Group` 对象而不是手写的 stub：`getBoundingRect()` 是 fabric
 * 自己的几何引擎（矩阵变换、旋转投影都在里面），这里要测的正是"喂给它真实 fabric
 * 对象，它算出来的并集对不对"，不是我们自己对着一份想象中的接口断言。fabric 对象
 * 不需要挂到 `Canvas`/`StaticCanvas` 上就能算 `getBoundingRect()`——同仓
 * `canvas-sticky-borderless.test.ts` 等文件已经验证过这条 headless 用法可行。
 *
 * ⚠ 每个 `Rect` 都显式传 `strokeWidth: 0`、`originX/originY: "left"/"top"`（旋转那条
 *   例外，见该测试注释）——fabric v7 默认 `originX`/`originY` 是 `"center"`（不是
 *   直觉上的"left/top 就是左上角"），默认 `strokeWidth: 1` 也会让 `getBoundingRect()`
 *   的宽高各多出一点描边。不显式关掉这两项，期望值会跟 fabric 实测差一个"看起来是
 *   四舍五入误差、实际是没读文档"的偏移量——这正是本文件想避免复现的那类坑。
 */
import { describe, it, expect } from "vitest";
import { Rect, Group } from "fabric";

// unionBoundingBox 目前是 canvas-stage.tsx 的内部实现细节，未对外导出——这里通过
// 动态 import 拿到模块内部导出（见该文件里 `export function unionBoundingBox`）。
import { unionBoundingBox } from "@/components/canvas/canvas-stage";

function rect(opts: { left: number; top: number; width: number; height: number; angle?: number; scaleX?: number; scaleY?: number }) {
  return new Rect({
    originX: "left", originY: "top", strokeWidth: 0,
    ...opts,
  });
}

describe("unionBoundingBox —— exportPNG 与 fitToContent 共用的并集包围盒", () => {
  it("空数组 ⇒ null（没有内容可「看到全部」/截图）", () => {
    expect(unionBoundingBox([])).toBeNull();
  });

  it("单个对象 ⇒ 包围盒就是它自己的矩形", () => {
    const r = rect({ left: 10, top: 20, width: 100, height: 50 });
    expect(unionBoundingBox([r])).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it("多个对象、且不在原点附近（off-origin）⇒ 并集覆盖所有对象，不只是靠近原点的那个", () => {
    const a = rect({ left: -200, top: -100, width: 50, height: 50 });
    const b = rect({ left: 500, top: 300, width: 80, height: 40 });
    const c = rect({ left: 100, top: 100, width: 20, height: 20 }); // 中间那个不该影响边界
    expect(unionBoundingBox([a, b, c])).toEqual({ minX: -200, minY: -100, maxX: 580, maxY: 340 });
  });

  it("旋转对象 ⇒ 用的是旋转后的轴对齐包围盒（AABB），不是旋转前的原始矩形", () => {
    // 绕中心点转——这里刻意保留默认的 center 原点语义（旋转天然应该绕物体中心转，
    // 不是绕左上角），一个 100×100 的正方形转 45° 后，轴对齐包围盒的对角线长度
    // = 100·√2 ≈ 141.42，明显大于旋转前的 100×100——用这条差异证明真的按变换后的
    // 几何算，不是抄了旋转前的原始宽高。
    const r = new Rect({
      left: 0, top: 0, width: 100, height: 100, angle: 45, strokeWidth: 0,
      originX: "center", originY: "center",
    });
    const box = unionBoundingBox([r])!;
    expect(box.maxX - box.minX).toBeCloseTo(100 * Math.SQRT2, 0);
    expect(box.maxY - box.minY).toBeCloseTo(100 * Math.SQRT2, 0);
  });

  it("缩放对象（scaleX/scaleY）⇒ 包围盒按缩放后的尺寸算", () => {
    const r = rect({ left: 0, top: 0, width: 50, height: 50, scaleX: 3, scaleY: 2 });
    const box = unionBoundingBox([r])!;
    expect(box.maxX - box.minX).toBeCloseTo(150, 5);
    expect(box.maxY - box.minY).toBeCloseTo(100, 5);
  });

  it("分组对象（Group）⇒ 并集看的是 group 的整体外框，落在 group 被放置的位置", () => {
    const inner = rect({ left: 0, top: 0, width: 40, height: 40 });
    const group = new Group([inner], { left: 300, top: 200, originX: "left", originY: "top" });
    const box = unionBoundingBox([group])!;
    expect(box.minX).toBeCloseTo(300, 5);
    expect(box.minY).toBeCloseTo(200, 5);
    expect(box.maxX - box.minX).toBeCloseTo(40, 5);
    expect(box.maxY - box.minY).toBeCloseTo(40, 5);
  });
});
