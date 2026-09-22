/**
 * 🔴 **故意漂移的反证夹具** —— issue #622。不要「修」它，它红着才是对的。
 *
 * ## 它证明什么
 *
 * `consent-items-single-source.test.ts` 的第 ② 条扫描器原本只走 `apps/api/src` +
 * `packages/contracts/src`。`apps/api/scripts/` 不在扫描范围里，于是种子脚本可以把
 * 同意项**再声明一遍**而门控一声不吭——2026-08-06 真实发生过一次：
 * `seed-fullstack-smoke.ts` 写的是字面量 `["record", "transcript", "ai_analysis"]`，
 * X-7/XC-18 裁成四项后它没跟着变，发现它靠的是 `fullstack-smoke` 第 7 步在 CI 上
 * 超时、人工追到 `403 CONSENT_NOT_COMPLETED`，**不是靠机械门控**。
 *
 * 本文件就是那次漂移的形状（三项字面量，少 `attribution`），放在**新扩进来的扫描根
 * 里面**。它把「扫描范围真的覆盖了 `apps/api/scripts/`」变成一条会失败的断言：
 *
 * · 用扩范围**之前**的两个根走一遍 ⇒ 这个文件根本不在文件列表里（盲区复现）；
 * · 用扩范围**之后**的三个根走一遍 ⇒ 它在列表里，且被 `declaresItemList` 判红。
 *
 * 没有这个文件，第 ② 条即使把根写错也照样全绿——本仓九次「绿色空转」的老形状。
 *
 * ## 为什么它不把第 ② 条本身弄红
 *
 * 它按**精确路径**被排除在 offenders 之外，与 `lint-naming-single-source.mjs` 的
 * `SELF_EXCLUDE` 同型；排除的同时，测试**正向断言**扫描器确实认出了它。所以这不是
 * 给门控开的口子：任何**别的**脚本这么写，照红不误。
 *
 * ⚠ 这里的三项是**旧的、错的**那一版，不是当前裁决。当前事实源永远是
 *   `packages/contracts/src/consent-item.ts` 的 `CONSENT_ITEMS`（四项）。
 *   本文件不 import 它，也不该被任何生产代码 import。
 */

/** 漂移版：少 `attribution`。⚠ 这是反面教材，不是可用常量。 */
export const DRIFTED_CONSENT_ITEMS = ["record", "transcript", "ai_analysis"] as const;

export type DriftedConsentItem = (typeof DRIFTED_CONSENT_ITEMS)[number];
