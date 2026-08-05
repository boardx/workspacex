/**
 * 导航信息架构（一级 / 二级）的**结构**判定 —— issue #593。
 *
 * ## 为什么是「结构」而不是「字符串在页面上」
 *
 * 本 issue 的故障是**位置错**，不是**缺失**：「蓝本」这四个字在改之前改之后都在页面上，
 * 所以任何 `expect(screen.getByText("蓝本")).toBeTruthy()` 形状的断言**两边都绿**，
 * 是典型的空转（本仓已九次「全绿但空转」）。这里断言的是三条关系：
 *   ① 某项**在**「后台」的二级里；② 它**不在**任何一级项里；③「后台」自己**在**一级。
 * 把改动还原（把「蓝本」放回一级「编排」）时，②必须红并**点名 templates**。
 *
 * ⚠ 断言的是**性质不是数量**（coding-standards 修订 E-4）：这里没有、也不许有
 *   「一级导航必须恰好 N 项」。新增一个经人裁的正当一级项不该撞死一个移动靶。
 */
import type { NavItem, NavSegment } from "./navigation";

/** 一级项（`IconRail` 画的那一层）的 key 集合。 */
export function topLevelKeys(segments: readonly NavSegment[]): string[] {
  return segments.flatMap((s) => s.items).map((i) => i.key);
}

/** 某个一级项的二级 key 集合（原型 COLUMN 2）。 */
export function secondLevelKeysOf(segments: readonly NavSegment[], parentKey: string): string[] {
  const parent = segments.flatMap((s) => s.items).find((i) => i.key === parentKey);
  return (parent?.children ?? []).map((c) => c.key);
}

/** 某个一级项所在的分组标签（用来断言「蓝本不在编排组」这类关系）。 */
export function segmentLabelOf(segments: readonly NavSegment[], key: string): string | null | undefined {
  const seg = segments.find((s) => s.items.some((i) => i.key === key));
  return seg ? seg.label : undefined;
}

/**
 * 判定：`keys` 里的每一项都必须是 `parentKey` 的**二级**，且都**不是**一级项。
 *
 * 返回**逐条点名**的错误清单；空数组 = 通过。判定五条：
 *   ① 空集防线：分组集合 / 一级项集合 / 要求集合 任一为空 ⇒ 失败
 *      （空集会让「都不在一级」平凡为真——本仓栽过的形状）
 *   ② 父项必须存在于一级：否则「移到后台之下」这句话本身没有落点
 *   ③ 正向：每个 key 必须出现在父项的 children 里（少了 = 入口丢了，成了敲 URL 才进得去的孤岛）
 *   ④ 反向：每个 key 都不得出现在一级项里（这正是 #593 的故障形状）
 *   ⑤ 二级不得为空：父项声明了要带 children 却是空的 ⇒ 失败
 */
export function diffNavIa({
  segments,
  parentKey,
  mustBeSecondLevel,
}: {
  segments: readonly NavSegment[];
  parentKey: string;
  mustBeSecondLevel: readonly string[];
}): string[] {
  const errors: string[] = [];

  if (segments.length === 0) errors.push("[空集] 导航分组集合为空 —— 空集会让「都不在一级」平凡为真，一律判失败。");
  if (mustBeSecondLevel.length === 0) errors.push("[空集] 要求降为二级的项集合为空 —— 同上，一律判失败。");
  const top = topLevelKeys(segments);
  if (top.length === 0) errors.push("[空集] 一级导航项集合为空 —— 同上，一律判失败。");
  if (errors.length > 0) return errors;

  const parent = segments.flatMap((s) => s.items).find((i) => i.key === parentKey);
  if (!parent) {
    errors.push(`[缺父项] 一级导航里找不到「${parentKey}」—— 「移到它下面」这句话没有落点。`);
    return errors;
  }
  const second = (parent.children ?? []).map((c) => c.key);
  if (second.length === 0) {
    errors.push(`[空集] 一级项「${parentKey}」的二级为空 —— 五项本该挂在这里，现在一个都没有。`);
    return errors;
  }

  for (const key of mustBeSecondLevel) {
    if (!second.includes(key)) {
      errors.push(
        `[不在二级] 「${key}」应当是一级项「${parentKey}」的二级模块（原型 COLUMN 2「后台模块」），` +
          `实际不在它的 children 里 —— 要么被放回了一级，要么入口整个丢了（只能敲 URL 进）。`,
      );
    }
    if (top.includes(key)) {
      const label = segmentLabelOf(segments, key);
      errors.push(
        `[仍在一级] 「${key}」还挂在一级导航（分组「${label ?? "无标签"}」）—— ` +
          `原型的一级只有 对话 / 编排:项目 / STUDIO / 能力 / 治理:后台，它不该跟「对话」平级。`,
      );
    }
  }

  return errors;
}

/** 一级项 + 二级项的 href 全集（供死链/可达性一类的断言复用，不在别处再抄一份）。 */
export function allNavHrefs(segments: readonly NavSegment[]): string[] {
  const items: NavItem[] = segments.flatMap((s) => s.items).flatMap((i) => [i, ...(i.children ?? [])]);
  return items.map((i) => i.href);
}
