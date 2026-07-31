/**
 * 后台左栏「每一项后面带一个数字」的计数解析（F133 / asset-governance I-24）。
 *
 * ## 本体：「取不到」与「0」是两件事，且互不传染
 *
 * `packages/contracts/src/asset-governance.ts` 的 `listAdminNav.out` 把每一项的
 * `count` 定义为 `number | "—"` 的联合，`null` 不合法。「—」= 这类资产的计数查询
 * 现在挂了；`0` = 查询成功、这类资产恰好一个都没有。合并成 0 会让一次后端故障
 * 在界面上长得像一个空目录——用户不会去报障，他会以为东西还没建。
 *
 * ⚠ 单类计数失败不拖垮整个左栏：这里**没有**一个包住全部来源的 try/catch。
 *   每一项的计数来源独立求值、独立捕获（见 `resolveAdminNavCounts` 的 for 循环），
 *   一个来源抛错只会让**它自己**变成「—」，兄弟项照常返回数字。
 *   一个整体失败的实现（catch 一次、全员判「—」）在「只断言某一项是—」的测试上也会绿，
 *   所以反证套件必须同时断言「其余项仍是数字」。
 */

/** 单项计数的对外形状——与契约 `listAdminNav.out.groups[].items[].count` 逐字同构。 */
export type AdminNavCount = number | "—";

/**
 * 计数来源：一个可能抛错的同步函数（真实实现里会是一次计数查询）。
 * 抛错本身就代表「这类资产的计数现在取不到」，调用方不需要另设一个「失败」返回值——
 * 有失败返回值就会有人手滑传 0 或 null 进去，把两件事重新焊在一起。
 */
export type AdminNavCountSource = () => number;

/**
 * 解析单个计数来源。
 * - 抛错 ⇒ `"—"`（I-24：不得用 0 顶替取不到）。
 * - 返回值不是「非负整数」⇒ 同样按「取不到」处理——形状不对本身就是一种取不到,
 *   不应该把 NaN / 负数 / 小数悄悄显示给用户。
 */
export function resolveAdminNavCount(source: AdminNavCountSource): AdminNavCount {
  try {
    const value = source();
    if (!Number.isInteger(value) || value < 0) return "—";
    return value;
  } catch {
    return "—";
  }
}

/**
 * 批量解析：逐项独立求值，任何一项抛错都不影响其余项。
 *
 * ⚠ 这里故意用 for 循环逐个 `resolveAdminNavCount`，而不是先把所有来源塞进一个数组
 * 再统一 try/catch——那样写会让"跑到一半才抛错"的来源连累它后面所有还没算的项，
 * 表现出来就是"单类失败拖垮整个左栏"，正是本 feature 要反证掉的那种实现。
 */
export function resolveAdminNavCounts<K extends string>(
  sources: Record<K, AdminNavCountSource>,
): Record<K, AdminNavCount> {
  const result = {} as Record<K, AdminNavCount>;
  for (const key of Object.keys(sources) as K[]) {
    result[key] = resolveAdminNavCount(sources[key]);
  }
  return result;
}
