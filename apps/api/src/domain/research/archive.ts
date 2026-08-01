/**
 * F146 —— 归档不删除：归档后仍能被「已归档」标签筛出，且被引用的证据仍可解析
 * （`research` 束 domain.md N-7，`uc-24-3` R7.3 / V4，`packages/contracts/src/research.ts`
 * `archiveResearch` 与 `RESEARCH_FORBIDDEN_ROUTES` 注释逐字）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的两半（只断言前半的实现会漏掉后半）
 *
 * 1. **前半：归档是「置位」不是「删除」。** `archiveResearch` 只把匹配项的
 *    `archivedAt` 从 `null` 改成一个时间戳，集合的长度、其余字段一律不变；
 *    `filterByArchived` 之后仍能用 `archived: true` 把它筛出来。
 * 2. **后半（D-20 的立论依据，`research.ts` 顶部注释逐字）：被这条研究引用/
 *    产出的证据，在归档之后**依然可以按 id 解析**。硬删除会让引用方
 *    （09-kg 证据 / 10-report 取材 / 14-brain 候选洞察）凭空断链——
 *    只测「列表里筛得到」而不测这一条，正是 `research.ts` 点名的漏测形状。
 *
 * ⚠ 本域**没有** `unarchiveResearch`（`KNOWN_CONTRACT_GAPS.R5`）——本文件因此
 *   也不提供反归档函数，不替裁决当前没有的东西发明一个。
 */

/** 归档只关心的最小字段形状（真实 `Research` 类型的子集）。 */
export interface ArchivableResearch {
  readonly id: string;
  readonly archivedAt: string | null;
}

/**
 * 归档一条研究：只置位 `archivedAt`，**绝不从集合中移除**元素、**绝不清空**其余字段。
 *
 * ⚠ 目标不存在时原样返回（不是静默丢弃也不是抛异常——`RESEARCH_ARCHIVED` /
 *   角色错误由调用方在应用层判定，这里只做"归档"这一件事的形状）。
 */
export function archiveResearch<T extends ArchivableResearch>(
  items: readonly T[],
  researchId: string,
  archivedAt: string,
): T[] {
  return items.map((r) => (r.id === researchId ? { ...r, archivedAt } : r));
}

/**
 * 按归档状态过滤（沿用 `listResearch.in.archived` 的三态语义）：
 * `null` = 不过滤（两者都要）、`true` = 只看已归档、`false` = 只看未归档。
 */
export function filterByArchived<T extends ArchivableResearch>(
  items: readonly T[],
  archived: boolean | null,
): T[] {
  if (archived === null) return [...items];
  return items.filter((r) => (r.archivedAt !== null) === archived);
}

/**
 * 引用方按 id 解析证据——**不管它挂靠的研究是否已归档**。
 *
 * ⚠ 这里刻意不接收 `archived` 相关参数：证据的可解析性与其所属研究的归档状态
 *   无关（N-7 后半）。一旦这个函数开始因为归档而返回 `undefined`，
 *   就是把「归档」悄悄实现成了「删除」。
 */
export function resolveEvidenceById<E extends { readonly id: string }>(
  evidenceStore: readonly E[],
  evidenceId: string,
): E | undefined {
  return evidenceStore.find((e) => e.id === evidenceId);
}
