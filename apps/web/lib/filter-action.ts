/**
 * 五种筛选动作 —— **单一事实源在 `@repo/contracts/filter-action`**。
 *
 * 收敛前这份事实有两份：契约是 `recall/downweight/exclude/paired/lead`，
 * `lib/mock/brain.ts` 是 `recall/downweight/exclude/pair/clue`——**后两个键对不上**，
 * 而两边都不会报错，直到有人想把界面上的「成对」跟 `items[].retrievalReasons` 里的
 * `paired` 对起来（同 `omission-reason.ts` 那次）。
 *
 * 本文件只做再导出。⚠ 不要在这里加任何定义——加了就是第二份副本。
 */
export * from "@repo/contracts/filter-action";
