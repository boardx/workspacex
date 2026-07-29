/**
 * 丢弃原因枚举 —— **单一事实源已迁至 `@repo/contracts/omission-reason`**（一致性复核 B-5）。
 *
 * 原因：`packages/contracts/src/context-pack.ts` 曾用 `../../../apps/web/lib/omission-reason`
 * 反向 import 它——**契约包依赖 app 包，方向反了**。契约是 app 的上游。
 *
 * 本文件只做再导出，让 app 内既有的 `@/lib/omission-reason` 引用无需改动。
 * ⚠ 不要在这里加任何定义——加了就是第二份副本（`lint-contract-source` 会拦）。
 */
export * from "@repo/contracts/omission-reason";
