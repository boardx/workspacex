/**
 * 迭代 16（#3773 R5）—— 「模型这一轮到底改了什么」。
 *
 * ## 为什么需要它
 *
 * 一轮对话之后，画布整体换了一份，而屏上没有任何痕迹说明**哪里**变了。
 * 三页里改了一个按钮文案，用户只能自己逐页找——于是"改一点点"这件事的成本
 * 和"重看一遍全部"一样高，而快速建模靠的恰恰是"改一点点"这件事足够便宜。
 *
 * ## 判据：按 id 对齐，比**自己这一层**
 *
 * 节点 id 在整个项目内唯一且跨轮稳定（`ensurePrototypeIds` 落库时补齐，patch 按它寻址）。
 * 所以：
 *   · 新出现的 id ⇒ 新增；
 *   · 同一个 id 的 `type` 或 `props` 变了 ⇒ 改动；
 *   · 容器的 `children` **不参与**比较——子节点自己会各自报告，把子树塞进父节点的比较里
 *     会让"改了最里面一个字"变成"从根到叶整条链全亮"，那等于没有高亮。
 *
 * ⚠ 被删掉的节点**不报**：它已经不在树上了，屏上没有东西可以高亮。谁被删了由对话
 *   那句话说，不由画布说。
 */
import type { PrototypeNode } from "@/lib/live-design-workbench";

/** 这一层自己的身份：类型 + props（不含 children）。 */
function shallowOf(node: PrototypeNode): string {
  const props = (node as { props?: unknown }).props;
  return JSON.stringify([node.type, props ?? null]);
}

function indexById(roots: readonly (PrototypeNode | null)[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (n: PrototypeNode): void => {
    if (n.id !== undefined) out.set(n.id, shallowOf(n));
    const kids = (n as { children?: readonly PrototypeNode[] }).children;
    if (kids !== undefined) for (const c of kids) walk(c);
  };
  for (const r of roots) if (r !== null) walk(r);
  return out;
}

/**
 * 新增或改动的节点 id。
 *
 * ⚠ `before` 为空（这个项目本来就没有原型）⇒ **返回空集**，不是"整棵树全是新的"。
 *   首次生成时整页都是新的，把整页每个节点都高亮起来等于满屏闪烁，说明不了任何事。
 */
export function changedNodeIds(
  before: readonly (PrototypeNode | null)[],
  after: readonly (PrototypeNode | null)[],
): ReadonlySet<string> {
  if (before.every((r) => r === null)) return new Set();
  const prev = indexById(before);
  const next = indexById(after);
  const out = new Set<string>();
  for (const [id, sig] of next) if (prev.get(id) !== sig) out.add(id);
  return out;
}
