/**
 * 「＋便签」落点的**命中判据**——`chat-path-c2-canvas-fence-identity.spec.ts` 那条
 * e2e 点击链路的反证，docker-free 版。
 *
 * ## 为什么需要这一份（它不是 e2e 的副本）
 *
 * C2 那条 e2e 要先把画布点脏（`chat-canvas-dirty`）才能保存、才能验「保存版归属」。
 * 它在 CI 上连红两轮，两轮都红在这一步：点下去**没落成便签**。根因不在判据、不在
 * 产品，而在**落点命中了谁**——而这件事在浏览器里只能靠 trace 看（本仓多数会话起不了
 * 那套隔离栈），在这里却是纯逻辑可判的：同一个 `CanvasStage`、同一支模板、同一条
 * `mouse:down` 处理链，只把坐标换成 e2e 用的那两个。
 *
 * ## 被钉住的机制：可编辑舞台上，`locked` 不再等于「点不到」
 *
 * 模板的分区框/标题/表头在 `template-engine.ts` 里都是 `locked: true`，`canvas-io.ts`
 * 据此 `set({ selectable: false, evented: false })`。**但那只是初值**：
 * `canvas-stage.tsx` 的只读态 effect 会对**全部对象**执行 `obj.evented = !readOnly`，
 * 于是全屏编辑器（`readOnly={false}`）里这些结构节点**全部重新变成 evented**，fabric
 * 的命中测试会把它们当 target 交给 `mouse:down`，而那里第一件事就是
 * `if (opt.target) { …; return; }`——「＋便签」只在**点到空白**时才落便签。
 *
 * 所以「点分区框内的空白处也能落便签」这个直觉是错的（C2 修复过程中曾据
 * `canvas-io.ts:133` 判断它成立，本文件第一条用例就是那条判断的反证）：分区框是一整块
 * 实心 target，点在它上面等于点在一个对象上。
 *
 * 两条用例用的坐标就是 C2 spec 用过的两个（画布尺寸按该 lane 的 `Desktop Chrome`
 * 视口算：全屏 modal 减去右栏 `w-80` ⇒ 约 960×675）：改坐标必然同步改这里，
 * 两处不会各漂各的。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Point, type Canvas as FabricCanvasType, type FabricObject } from "fabric";
import { registerTemplate } from "@repo/fabric-markdown";
import { buildExplicitTemplateSpec } from "@/lib/canvas/explicit-template-layout";

// 截获真实 fabric.Canvas 实例——手法与 `canvas-stage-edge-editability.test.tsx` /
// `canvas-stage-sticky-color-menu.test.tsx` 同款，不 mock 渲染/序列化的任何一步。
vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  class ObservedCanvas extends actual.Canvas {
    constructor(...args: ConstructorParameters<typeof actual.Canvas>) {
      super(...args);
      (globalThis as unknown as Record<string, unknown>)["__lastFabricCanvas"] = this;
    }
  }
  return { ...actual, Canvas: ObservedCanvas };
});

import { CanvasStage } from "@/components/canvas/canvas-stage";

/**
 * 形状复刻 C2 e2e 真正渲染的那张模板：`seed-chat-read-e2e.ts` 种下的
 * `chat-read-e2e-canvas`——一行表头字段（`短文本`，row 1，跨满 12 列）+ 一个便利贴
 * 分区（row 2，高 7 行）。几何走的是同一个 `buildExplicitTemplateSpec`，不是手写坐标。
 */
const { spec } = buildExplicitTemplateSpec({
  key: "sticky-drop-hit-target-check",
  displayName: "会话画布验收模板",
  sections: [
    {
      sectionId: "header-field-1", name: "姓名", type: "短文本",
      layout: { col: 1, row: 1, w: 12, h: 1, cols: 3, max: 3, tone: 0, overflow: "截断" },
    },
    {
      sectionId: "section-1", name: "要点", type: "便利贴列表",
      layout: { col: 1, row: 2, w: 12, h: 7, cols: 3, max: 6, tone: 0, overflow: "缩小字号" },
    },
  ],
  gridCols: 12,
});
registerTemplate(spec);

const MARKDOWN = [
  "```canvas",
  `模板: ${spec.key}`,
  "姓名: 并排两张图 之一",
  "## 要点",
  "- 并排两张图 之一",
  "```",
].join("\n");

/** C2 lane 的 `Desktop Chrome` 视口 1280×720，减去全屏 modal 头部与右栏 `w-80`。 */
const CANVAS = { width: 960, height: 675 } as const;

/** fabric 的 `data` 是自由字段，类型里没有它——`template-engine.ts` 往里放的就是这个形状。 */
function roleOf(obj: FabricObject | undefined): string {
  if (obj === undefined) return "无命中";
  return (obj as unknown as { data?: { role?: string } }).data?.role ?? "无命中";
}

/** fabric 的命中规则：从最上层往下找第一个 `evented` 且包含该点的对象。 */
function hitTest(canvas: FabricCanvasType, x: number, y: number): FabricObject | undefined {
  const point = new Point(x, y);
  return [...canvas.getObjects()].reverse().find((o) => o.evented && o.containsPoint(point));
}

function stickyCount(canvas: FabricCanvasType): number {
  return canvas.getObjects().filter((o) => roleOf(o) === "sticky").length;
}

async function mountStage(onMarkdownChange: ReturnType<typeof vi.fn>): Promise<FabricCanvasType> {
  render(
    <CanvasStage readOnly={false} tool="sticky" zoom={1} markdown={MARKDOWN} onMarkdownChange={onMarkdownChange} />,
  );
  await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
  const canvas = (globalThis as unknown as Record<string, unknown>)["__lastFabricCanvas"] as FabricCanvasType;
  await waitFor(() => expect(canvas.getObjects().some((o) => roleOf(o) === "section")).toBe(true));
  // 只读态 effect（`obj.evented = !readOnly`）跑在渲染之后的那一次 commit 上，等它落地。
  await waitFor(() => expect(canvas.getObjects().every((o) => o.evented)).toBe(true));
  return canvas;
}

/** 复刻 `page.mouse.click(x, y)` 在这条链上的效果：fabric 自己做命中，再派发 mouse:down。 */
function clickCanvasAt(canvas: FabricCanvasType, x: number, y: number): void {
  canvas.fire("mouse:down", {
    target: hitTest(canvas, x, y),
    e: new MouseEvent("mousedown", { clientX: x, clientY: y }),
  } as never);
}

describe("CanvasStage「＋便签」落点命中判据（C2 e2e 点击链路的反证）", () => {
  it("点分区框内（C2 前两轮 CI 用的 80%/80%）：命中分区框 ⇒ 便签落不下、markdown 不回写", async () => {
    const onMarkdownChange = vi.fn();
    const canvas = await mountStage(onMarkdownChange);
    const before = stickyCount(canvas);

    const x = CANVAS.width * 0.8;
    const y = CANVAS.height * 0.8;
    // 这一行就是 CI 两轮红的全部原因：分区框是 evented 的，点它 = 点到一个对象。
    expect(roleOf(hitTest(canvas, x, y)), "80%/80% 落在分区框内").toBe("section");

    clickCanvasAt(canvas, x, y);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stickyCount(canvas), "点在分区框上不会落便签").toBe(before);
    expect(
      onMarkdownChange,
      "没有新便签就没有回写——`chat-canvas-dirty` 因此永远不出现，这正是 C2 的超时现场",
    ).not.toHaveBeenCalled();
  });

  it("点标题带右侧空白（C2 现在用的坐标）：无命中 ⇒ 便签真的落下并回写 markdown", async () => {
    const onMarkdownChange = vi.fn();
    const canvas = await mountStage(onMarkdownChange);
    const before = stickyCount(canvas);

    const x = CANVAS.width * 0.8;
    const y = 60;
    expect(roleOf(hitTest(canvas, x, y)), "标题带右半边没有任何对象").toBe("无命中");

    clickCanvasAt(canvas, x, y);

    await waitFor(() => expect(stickyCount(canvas)).toBe(before + 1));
    await waitFor(() => expect(onMarkdownChange).toHaveBeenCalled());
    const markdown = onMarkdownChange.mock.calls.at(-1)?.[0] as string;
    // 落点在所有分区框之外 ⇒ 走 `mouse:down` 的夹取分支，归入最近的分区（这里只有「要点」），
    // 不是"没有分区的游离便签"。
    expect(markdown, "新便签序列化进了「要点」分区").toContain("- 新便签（点选可改标签）");
    expect(markdown, "原有内容不受影响").toContain("- 并排两张图 之一");
  });
});
