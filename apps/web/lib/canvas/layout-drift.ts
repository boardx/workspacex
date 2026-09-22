/**
 * 「用户挪动过的节点」——画布几何漂移检测（issue #3642）。
 *
 * ## 为什么需要它
 *
 * 画布的持久化形式是 **mermaid 源码**（D-08 / R7 规则②，`apps/api/tests/canvas/
 * coords-not-written-back.test.ts` 机械钉死）：mermaid 语法里没有坐标位，写回只保留
 * 结构，重新打开由 mermaid 自动布局。推论是**挪动节点这件事在保存那一刻必然丢失**。
 *
 * 这本身是刻意的设计，真正的缺陷是界面不说：`CanvasStage` 回吐给上层的只有
 * markdown，而「只挪了位置」产出的 markdown 与挪之前**逐字相同**——上层因此既看不出
 * 用户改过东西，也无从知道这次改动保存不了，于是保存照常回一个成功态（issue #3642
 * 实测：界面写「已保存 · 05:05:52」，刷新后方框回原位）。
 *
 * 这个模块补的就是那条缺失的信号：把「本次加载后的几何」与「当前几何」对比，
 * 告诉上层**哪些节点被挪/改过尺寸**。上层据此如实提示或拦下，不再假报成功。
 *
 * ## 只比两边都在的节点（故意的）
 *
 * 新增 / 删除节点是**结构**改动，本来就能写进 mermaid 源、能真正保存，不该被算成
 * 「保存不了的几何改动」。所以对比只覆盖 id 在前后两份快照里都存在的节点——新增节点
 * 落点丢失是同一条设计推论，但它随结构一起保存、不构成「点了保存却什么都没变」的
 * 假成功，不在本信号的职责里。
 */
import type { DiagramModel } from "@repo/fabric-markdown";

/** 一个节点的几何：`[x, y, width, height]`，均已取整（见 `GEOMETRY_EPSILON`）。 */
export type NodeGeometry = readonly [number, number, number, number];

/** 节点 id → 几何。`CanvasStage` 在「刚加载完」与「每次编辑后」各取一份。 */
export type GeometrySnapshot = Readonly<Record<string, NodeGeometry>>;

/**
 * 小于 1px 的差异不算「挪过」——fabric 的坐标是浮点，缩放/渲染会带亚像素噪声，
 * 拿它当「用户挪了节点」会让提示条无缘无故常驻。用户真的拖一下远不止 1px。
 */
export const GEOMETRY_EPSILON = 1;

/** 从模型取一份几何快照。 */
export function snapshotGeometry(model: DiagramModel): GeometrySnapshot {
  const snapshot: Record<string, NodeGeometry> = {};
  for (const node of model.nodes) {
    snapshot[node.id] = [node.x, node.y, node.width, node.height];
  }
  return snapshot;
}

/**
 * 相对 `before`，`after` 里位置或尺寸变了的节点 id（按 id 排序，稳定可比）。
 * 只看两边都有的 id——见文件头「只比两边都在的节点」。
 */
export function movedNodeIds(before: GeometrySnapshot, after: GeometrySnapshot): string[] {
  const moved: string[] = [];
  for (const [id, now] of Object.entries(after)) {
    const then = before[id];
    if (!then) continue;
    if (now.some((v, i) => Math.abs(v - then[i]!) >= GEOMETRY_EPSILON)) moved.push(id);
  }
  return moved.sort();
}
