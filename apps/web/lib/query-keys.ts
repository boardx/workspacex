/**
 * ADR-109 —— TanStack Query key 命名约定的单一登记点。
 *
 * 背景：迁移前 32 个 `lib/live-*.ts` 域各自约定了自己的 fetch/竞态处理写法，
 * 没有一处统一登记——这正是本 ADR 要收敛的问题之一。这里不是"给每个域重新发明
 * 一套写法"，是给 query key 的**命名**定一个单点：新增一个域的 query 时，先来这里
 * 加一个 factory，不要在消费组件里手写字面量数组。
 *
 * 约定：每个 factory 返回的 key 数组第一项固定是域名（与对应 `lib/live-*.ts` 文件名的
 * `live-` 前缀去掉后一致），后续项是让这个 query 在該域内保持唯一的参数，从粗到细排列
 * （方便用 `queryKey: queryKeys.tasks.all(projectId)` 这种前缀做批量失效）。
 */

export const queryKeys = {
  adminNavCounts: {
    /** 一次性拉齐 `LIVE_COUNT_KEYS` 这批口径明确的项；orgId 变化 = 完全不同的 query，
     * 不复用上一个组织的缓存（`lib/live-admin-nav-counts.ts` 原有语义：换组织不能
     * 短暂显示上一个组织的数字）。 */
    all: (orgId: string | null) => ["adminNavCounts", orgId] as const,
  },
} as const;
