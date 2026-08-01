/**
 * 项目 → 蓝本版本的快照绑定（F30 / AC1 · AC2，`uc-2-4` R7「快照绑定（本用例的核心）」）。
 *
 * 纯函数与纯数据：没有时钟、没有 I/O、没有存储。
 *
 * ## 本文件只落一条性质
 *
 * **快照不漂移**：项目持有的是一个 `blueprintVersionId`**引用**，不是内容的深拷贝
 * （`domain.md` / R10「快照语义…是引用不可变版本，不是深拷贝」）。
 * 引用永远按 id 解析到`该 id 对应的那一条不可变记录`——蓝本之后发布多少个新版本，
 * 都不改变「这个 id 解析出什么」这件事，因为 `publishNewVersion`（见 `blueprint-version.ts`）
 * 只**追加**记录、只把旧记录的 `state` 从 `published` 改成 `archived`，
 * **从不改写 `content` / `changedDesignFacetKeys` 等冻结字段**。
 *
 * ⚠ 「不漂移」不是「binding 对象本身不变」（它当然不变，从没人写它），
 *   而是「binding 解析出的**版本内容**在历史增长后仍等于绑定时那一份」——
 *   所以断言必须跨越一次 `publishNewVersion` 调用来写，而不是只读一次静态历史。
 */

import type { BlueprintVersion } from "./blueprint-version";

/** 项目侧持有的引用。⚠ 只有一个字段指向版本——不存在第二个「当前使用版本」字段。 */
export interface ProjectBlueprintSnapshot {
  readonly projectId: string;
  readonly blueprintVersionId: string;
}

/**
 * 按 id 解析出快照指向的那条版本记录。
 *
 * ⚠ 刻意不是「取 history 里状态为 published 的那条」或「取最后一条」——
 *   两种写法都会让绑定跟着蓝本的当前状态漂移，而不是钉死在绑定发生时的那个 id 上。
 */
export function resolveBoundVersion(
  snapshot: ProjectBlueprintSnapshot,
  history: readonly BlueprintVersion[],
): BlueprintVersion | undefined {
  return history.find((v) => v.id === snapshot.blueprintVersionId);
}

/**
 * AC2 的可断言形态：同一个快照，在「发布前的历史」与「发布后的历史」两侧解析，
 * 拿到的版本**内容逐字段相等**（`agenda`、`content`、`changedDesignFacetKeys` 均不变）。
 *
 * ⚠ 用内容相等而不是引用相等（`===`）：领域层允许调用方传入结构相同但非同一对象的
 *   历史数组（例如从存储层重新反序列化后的记录），这条断言不应该因为对象身份不同而假红。
 */
export function snapshotUnaffectedByPublish(
  snapshot: ProjectBlueprintSnapshot,
  historyBefore: readonly BlueprintVersion[],
  historyAfter: readonly BlueprintVersion[],
): boolean {
  const before = resolveBoundVersion(snapshot, historyBefore);
  const after = resolveBoundVersion(snapshot, historyAfter);
  if (!before || !after) return false;
  return (
    before.id === after.id &&
    before.versionNumber === after.versionNumber &&
    before.rolledBackFrom === after.rolledBackFrom &&
    JSON.stringify(before.content) === JSON.stringify(after.content) &&
    JSON.stringify(before.changedDesignFacetKeys) === JSON.stringify(after.changedDesignFacetKeys)
  );
}
