// @vitest-environment jsdom
/**
 * `FlowEdge` 曲线弯曲度上限回归 —— issue #2373。
 *
 * `packages/fabric-markdown` 是并入的 vendor 包（`VENDOR.md` 明确允许为真实 bug 改
 * `src/**`，但要求「新增覆盖放在 apps/web 那一侧」，这就是那份覆盖）。
 *
 * 真实反馈：流程图里一条跨度很大的"回边"（比如循环/往返关系）画出的弧线夸张地
 * 绕到画布很远的一侧。根因是 `FlowEdge._render`（`fabric-objects.ts`）算控制点
 * 法向偏移量（"bow"）时只有 `Math.max(len * k, 14)` 的下限、没有上限——边越长
 * 偏移量线性放大，长回边（`dominant < -20` 时 `k` 还会再乘 1.8）能被推到边长的
 * 三分之一左右，控制点因此被甩到极远处。
 *
 * 修法是在 `Math.max` 外面再套一层 `Math.min(..., MAX_BOW)`。这里不读 vendor 的
 * 私有实现细节（`bow`/`cpx`/`cpy` 都是 `_render` 内部变量，没有公开出口），而是
 * 用真实 `StaticCanvas` + 真实渲染，spy 住 `CanvasRenderingContext2D.prototype
 * .quadraticCurveTo` 拿到浏览器/node-canvas 实际收到的控制点坐标——这是黑盒验证，
 * 不依赖读到 vendor 源码里那个具体常量叫什么名字。
 */
import { describe, it, expect, vi } from "vitest";
import { StaticCanvas, type Canvas } from "fabric";
import { renderToCanvas, FlowEdge, type DiagramModel } from "@repo/fabric-markdown";

/** 弦中点到控制点的垂直距离——即 vendor 内部说的 "bow"，从外部黑盒量出来。 */
function perpendicularOffset(
  ax: number, ay: number, bx: number, by: number, cpx: number, cpy: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // 弦向量与 (控制点 - 弦中点) 的叉积/弦长 = 垂直距离。
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const cross = dx * (cpy - my) - dy * (cpx - mx);
  return Math.abs(cross) / len;
}

describe("FlowEdge 曲线弯曲度上限（issue #2373）", () => {
  it("跨度很大的回边：控制点偏移不再随边长线性放大，被封顶", async () => {
    // 两个节点垂直相距很远（1200px），边从下面的节点指回上面的节点——
    // dominant 轴（这里是 dy）为负、且 |dy| 远大于 20，命中 vendor 判定的
    // "backward edge"（1.8× 曲率），是最容易画出夸张宽弧的场景。
    const model: DiagramModel = {
      kind: "flowchart",
      direction: "TD",
      nodes: [
        { id: "top", label: "上面的节点", shape: "rect", x: 0, y: 0, width: 40, height: 20 },
        { id: "bottom", label: "下面的节点", shape: "rect", x: 0, y: 1200, width: 40, height: 20 },
      ],
      edges: [{ id: "back", source: "bottom", target: "top", kind: "arrow" }],
    };

    const canvas = new StaticCanvas(undefined, { width: 2000, height: 2000 }) as unknown as Canvas;
    renderToCanvas(model, canvas);

    const edges = canvas.getObjects().filter((o) => o instanceof FlowEdge);
    expect(edges).toHaveLength(1);

    const ctx = canvas.getContext();
    const spy = vi.spyOn(ctx, "quadraticCurveTo");
    canvas.renderAll();

    expect(spy).toHaveBeenCalled();
    // moveTo 到这条边起点、quadraticCurveTo 到控制点再到（近似的）终点——
    // 取最后一次调用，避免拿到其它对象（比如箭头/标签）里可能出现的曲线段。
    const lastCall = spy.mock.calls.at(-1)!;
    const [cpx, cpy, ex, ey] = lastCall as unknown as [number, number, number, number];

    // 起点：canvas 上唯一一条边的 moveTo，用 ctx.moveTo 的 spy 拿不到就退而求其次——
    // 直接用两个节点的画布坐标近似弦端点（renderToCanvas 会把 margin=24 加进去，
    // 节点中心 x 不变、y 分别是 24+10 与 24+1200+10 附近，允许较大容差）。
    const ax = 24 + 20, ay = 24 + 10;
    const bx = 24 + 20, by = 24 + 1200 + 10;

    const bow = perpendicularOffset(ax, ay, bx, by, cpx, cpy);

    // 未封顶前：len≈1200，k=0.18×1.8=0.324，bow≈388.8——远超合理范围。
    // 封顶后：bow 应该是一个不随边长继续增长的小值（约几十像素量级），
    // 不应该是 100+（更别提 300+）。
    expect(bow).toBeLessThan(100);
    expect(bow).toBeGreaterThan(0); // 仍然是曲线，不是退化成直线。

    // 用 (ex, ey) 佐证这确实是往「回」画的那条边（终点应该在起点上方附近），
    // 不是巧合命中了别的曲线段。
    expect(ey).toBeLessThan(by);

    spy.mockRestore();
  });

  it("短边（相邻节点，非回边）：不再画曲线——2026-09-01 devapp 反馈修订", () => {
    // ⚠ 这条用例的断言方向在 2026-09-01 反过来了。原来的版本断言"短边仍保留最小
    // 弯曲度"，是为了证明 issue #2373 的封顶不会顺带把短边拉直——那时"所有非
    // seq/mindmap 边默认画曲线"本身是既定行为（VISUAL-SPEC S2）。真实 devapp 反馈
    // （"connectors of workflow was not rendered correctly, should not curve"）
    // 之后，`FlowEdge.isCurved()` 改成只有"回边"（against 主轴方向）才画曲线——
    // 普通前向边（这条：A 在上、B 在下，dy 为正）现在应该是直线，不再调用
    // `quadraticCurveTo`。
    const model: DiagramModel = {
      kind: "flowchart",
      direction: "TD",
      nodes: [
        { id: "a", label: "A", shape: "rect", x: 0, y: 0, width: 40, height: 20 },
        { id: "b", label: "B", shape: "rect", x: 0, y: 60, width: 40, height: 20 },
      ],
      edges: [{ id: "e", source: "a", target: "b", kind: "arrow" }],
    };
    const canvas = new StaticCanvas(undefined, { width: 400, height: 400 }) as unknown as Canvas;
    renderToCanvas(model, canvas);

    const ctx = canvas.getContext();
    const curveSpy = vi.spyOn(ctx, "quadraticCurveTo");
    const lineSpy = vi.spyOn(ctx, "lineTo");
    canvas.renderAll();

    // 核心断言：普通前向边不再产生任何二次曲线段——这条边唯一的曲线来源就是
    // 它自己（画布上只有这一条边、没有 mindmap/回边），没调用就是真的直了。
    expect(curveSpy).not.toHaveBeenCalled();
    // 反证：不是"什么都没画出来"——直线段（含箭头三角形的边）确实被画了。
    expect(lineSpy).toHaveBeenCalled();

    curveSpy.mockRestore();
    lineSpy.mockRestore();
  });

  it("回边（跨度不大，但方向相反）：仍然画曲线，不因为默认改直线就连回边也拉直", () => {
    // 与上一条对照：同样是两个相邻节点，但边的方向反过来（B -> A，指回上方）——
    // 命中 `isBackward()`，应该仍然走 `quadraticCurveTo`。回边不曲线化会让循环
    // 分支的箭头直接穿过中间节点，读起来像指错了对象，这条曲线不是装饰，是
    // 图例可读性所需要的。
    const model: DiagramModel = {
      kind: "flowchart",
      direction: "TD",
      nodes: [
        { id: "a", label: "A", shape: "rect", x: 0, y: 0, width: 40, height: 20 },
        { id: "b", label: "B", shape: "rect", x: 0, y: 60, width: 40, height: 20 },
      ],
      edges: [{ id: "back", source: "b", target: "a", kind: "arrow" }],
    };
    const canvas = new StaticCanvas(undefined, { width: 400, height: 400 }) as unknown as Canvas;
    renderToCanvas(model, canvas);

    const ctx = canvas.getContext();
    const spy = vi.spyOn(ctx, "quadraticCurveTo");
    canvas.renderAll();

    expect(spy).toHaveBeenCalled();
    const [cpx, cpy] = spy.mock.calls.at(-1)! as unknown as [number, number, number, number];
    const ax = 24 + 20, ay = 24 + 60 + 10;
    const bx = 24 + 20, by = 24 + 10;
    const bow = perpendicularOffset(ax, ay, bx, by, cpx, cpy);

    // 下限 14px 仍然生效——回边不会因为普通边改直线就跟着被拉直。
    expect(bow).toBeGreaterThanOrEqual(13);
    spy.mockRestore();
  });
});
