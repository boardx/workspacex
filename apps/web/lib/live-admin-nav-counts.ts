"use client";

import * as React from "react";
import { listCapabilities } from "./live-capabilities";
import type { AdminNavCountSource } from "./admin-nav-counts";
import type { AdminModuleKey } from "./mock/admin";

/**
 * #881 F3 —— 后台左栏计数改取**真实组织数据**。
 *
 * ## 起因：左栏写「Skill 11」，右边列表写「共 5 条」
 *
 * 因为左栏那排数字一直取自 `lib/mock/admin.ts` 的静态常量（`skill: () => SKILLS.length`），
 * 与当前组织**无关**。一个真实用户当场发现了这个矛盾。
 * 这不是显示 bug，是「界面上的数字不是这个组织的数字」。
 *
 * ## 只接口径明确的两项，其余一律「—」
 *
 * ⛔ 本文件**不**给其余八项编数字。`mock/admin.ts` 的注释逐字写明它们的口径
 * 「待 Q-11」（总览/反馈取"待处理"还是"全部"、六种资产各自数什么），
 * 未裁决就编一个数，等于把一个待裁决问题伪装成已解决。
 *
 * 口径明确的是这两项，因为它们与各自那一屏**看的是同一个列表**：
 *   · `agent` = `GET /capabilities?kind=agent` 的条数（后台 Agent 目录页展示的就是它）
 *   · `skill` = `GET /capabilities?kind=skill` 的条数（同上，Skill 目录页）
 * ⇒ 左栏数字与点进去看到的「共 N 条」**必然一致**，这正是本 issue 要修的那个矛盾。
 *
 * ## 「取不到」必须是「—」，不是 0（I-24）
 *
 * 没登录 / 没 orgId / 请求失败 / 还没加载完 ⇒ 计数来源**抛错** ⇒
 * `resolveAdminNavCount` 判「—」。
 * ⛔ 绝不 `?? 0`：`0` 的意思是"查成功且确实一个都没有"，把故障显示成空目录，
 *   用户不会去报障，他会以为东西还没建（`admin-nav-counts.ts` 头注写过同一条）。
 * ⛔ 也绝不在这里回退到 mock —— 那正是本 issue 要消灭的东西。
 */

/** 计数取不到时的来源：抛错，交给 `resolveAdminNavCount` 判「—」。 */
const unavailable: AdminNavCountSource = () => {
  throw new Error("count unavailable");
};

/** 口径明确、且与对应屏幕看同一个列表的两项。 */
export const LIVE_COUNT_KEYS = ["agent", "skill"] as const;
export type LiveCountKey = (typeof LIVE_COUNT_KEYS)[number];

export type LiveCounts = Partial<Record<LiveCountKey, number>>;

/**
 * 读真实计数。**每一项独立捕获**——一类失败不能连累另一类
 * （与 `resolveAdminNavCounts` 逐项求值同一条纪律）。
 */
export async function fetchLiveAdminNavCounts(orgId: string): Promise<LiveCounts> {
  const entries = await Promise.all(
    LIVE_COUNT_KEYS.map(async (key) => {
      try {
        const rows = await listCapabilities(orgId, key);
        return [key, rows.length] as const;
      } catch {
        // 这一类取不到 ⇒ 不放进结果 ⇒ 下面构造来源时它是 `unavailable` ⇒ 显示「—」
        return [key, undefined] as const;
      }
    }),
  );
  const out: LiveCounts = {};
  for (const [key, value] of entries) if (value !== undefined) out[key] = value;
  return out;
}

/**
 * 把真实计数装配成左栏要的 `Record<AdminModuleKey, AdminNavCountSource>`。
 * 没拿到的项一律 `unavailable`（⇒「—」）。
 */
export function buildAdminNavCountSources(
  keys: readonly AdminModuleKey[],
  live: LiveCounts,
): Record<AdminModuleKey, AdminNavCountSource> {
  const sources = {} as Record<AdminModuleKey, AdminNavCountSource>;
  for (const key of keys) {
    const value = (live as Record<string, number | undefined>)[key];
    sources[key] = value === undefined ? unavailable : () => value;
  }
  return sources;
}

/**
 * 左栏用的 hook。`orgId` 为 null（未登录 / 还没拿到会话）⇒ 全部「—」。
 * ⚠ 刻意不做「加载中显示上一次的数字」：那会在换组织后短暂显示**上一个组织**的计数。
 */
export function useLiveAdminNavCounts(
  orgId: string | null,
  keys: readonly AdminModuleKey[],
): Record<AdminModuleKey, AdminNavCountSource> {
  const [live, setLive] = React.useState<LiveCounts>({});

  React.useEffect(() => {
    setLive({});
    if (orgId === null) return;
    let cancelled = false;
    void fetchLiveAdminNavCounts(orgId).then((counts) => {
      if (!cancelled) setLive(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return React.useMemo(() => buildAdminNavCountSources(keys, live), [keys, live]);
}
