/**
 * 迭代 15 —— 画布上的节点动作（复制 / 上移 / 下移 / 键盘导航）。
 *
 * ## 为什么是**纯函数算 op**，而不是各处各写一段
 *
 * 这些动作有三个入口：属性面板的按钮、图层面板的右键、键盘快捷键。三处各写一遍
 * "复制是什么意思"，迟早会出现"面板里复制会带 id、键盘复制不带"这种分叉。
 * 这里只算出 `PrototypePatchOp[]`，谁调都走**同一条写回路径**（I-11：人改与模型改
 * 同一条路），失败原因也由同一处翻译。
 *
 * ## 为什么不新增 `move` op
 *
 * 契约已有 `remove` + `insert`，而 `applyPrototypePatch` 按顺序执行——
 * 「先删掉、再插到新位置」就是移动。新增一个 op 意味着契约、校验、模型 guide、
 * 服务端应用逻辑各多一处要维护，换来的只是少写一行。
 */
import { designPrototype } from "@repo/contracts";

type PrototypeNode = designPrototype.PrototypeNode;
type PrototypePatchOp = designPrototype.PrototypePatchOp;

/** 容器才有 children；叶子节点没有。 */
const childrenOf = (n: PrototypeNode): readonly PrototypeNode[] =>
  designPrototype.isPrototypeContainer(n) ? n.children : [];

/**
 * 定位一个节点的**家庭关系**：父、在父里的下标、兄弟。
 * 根节点没有父 ⇒ `parent` 为 null（根不能删、不能移、不能复制，调用方据此禁用按钮）。
 */
export function locate(
  prototype: readonly (PrototypeNode | null)[],
  id: string,
): { readonly node: PrototypeNode; readonly parent: PrototypeNode | null; readonly index: number; readonly siblings: readonly PrototypeNode[] } | null {
  const hit = designPrototype.findPrototypeNodePath(prototype, id);
  if (hit === null) return null;
  const node = hit.path[hit.path.length - 1]!;
  const parent = hit.path.length >= 2 ? hit.path[hit.path.length - 2]! : null;
  const siblings = parent === null ? [] : childrenOf(parent);
  return { node, parent, index: siblings.findIndex((c) => c.id === id), siblings };
}

/**
 * 去掉整棵子树的 id。
 *
 * ⚠ 复制**必须**去 id：id 在项目内唯一，带着原 id 插进去会造出两个同 id 的节点，
 * 之后任何按 id 寻址的操作（选中、setProps、连线）都会命中第一个，改了 A 却看到 B 变。
 * 服务端的 `ensurePrototypeIds` 会给没有 id 的节点补上新的。
 */
export function stripIds(n: PrototypeNode): PrototypeNode {
  const { id: _drop, ...rest } = n as PrototypeNode & { id?: string };
  return (designPrototype.isPrototypeContainer(n)
    ? { ...rest, children: n.children.map(stripIds) }
    : rest) as PrototypeNode;
}

/** 复制选中节点，副本紧跟在它后面。根节点不可复制（一页只有一个根）。 */
export function duplicateOps(prototype: readonly (PrototypeNode | null)[], id: string): readonly PrototypePatchOp[] | null {
  const at = locate(prototype, id);
  if (at === null || at.parent?.id === undefined || at.index < 0) return null;
  return [{ op: "insert", parentId: at.parent.id, index: at.index + 1, node: stripIds(at.node) }];
}

/**
 * 兄弟间上移 / 下移。到头了返回 `null`（调用方据此禁用按钮，而不是发一个什么都不做的请求）。
 *
 * 实现是 remove + insert：`applyPrototypePatch` 按顺序执行，所以插入下标要按
 * **删除之后**的数组来算——`dir < 0` 时目标下标是 `index - 1`，`dir > 0` 时
 * 删掉自己后原来的 `index + 1` 已经变成 `index`，所以目标是 `index + 1` 仍然正确。
 * 这一处差一格就会变成"下移两格"或"原地不动"，V80 用真实的树钉住它。
 */
export function moveOps(
  prototype: readonly (PrototypeNode | null)[],
  id: string,
  dir: -1 | 1,
): readonly PrototypePatchOp[] | null {
  const at = locate(prototype, id);
  if (at === null || at.parent?.id === undefined || at.index < 0) return null;
  const next = at.index + dir;
  if (next < 0 || next >= at.siblings.length) return null;
  // 移动保留原 id（和复制相反）：它还是同一个节点，只是换了位置——
  // 去了 id 会让选中态、连线全部指向一个不存在的东西。
  return [{ op: "remove", id }, { op: "insert", parentId: at.parent.id, index: next, node: at.node }];
}

/** 键盘导航的四个方向。返回要选中的节点 id，走不动就返回 `null`（保持原选中，不清空）。 */
export function navigate(
  prototype: readonly (PrototypeNode | null)[],
  id: string,
  dir: "up" | "down" | "prev" | "next",
): string | null {
  const at = locate(prototype, id);
  if (at === null) return null;
  if (dir === "up") return at.parent?.id ?? null;
  if (dir === "down") return childrenOf(at.node)[0]?.id ?? null;
  const step = dir === "prev" ? -1 : 1;
  return at.siblings[at.index + step]?.id ?? null;
}
