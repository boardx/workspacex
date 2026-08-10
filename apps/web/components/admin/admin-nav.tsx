"use client";

import Link from "next/link";
import { Bot, Boxes, Cpu, Plug, Shapes, LayoutTemplate, LayoutDashboard, Users, MessageSquareHeart, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { useOptionalSession } from "@/components/session/session-provider";
import { useLiveAdminNavCounts } from "@/lib/live-admin-nav-counts";
import { ADMIN_NAV_TESTID } from "./asset-kind-nav";
import { resolveAdminNavCounts, type AdminNavCountSource } from "@/lib/admin-nav-counts";
import { ADMIN_SECOND_LEVEL } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 后台二级模块（从 navigation.ts 的「后台」children 取）的稳定 testid —— 供 e2e 锚定。 */
export const adminSubNavTestId = (key: string) => `admin-sub-${key}`;

const ICONS: Record<AdminModuleKey, LucideIcon> = {
  agent: Bot,
  skill: Boxes,
  model: Cpu,
  mcp: Plug,
  // 画布模板与项目蓝本：与全局左栏「画布」「蓝本」用同一个符号——同一件事在两处要看起来是同一件事
  canvasadmin: Shapes,
  blueprint: LayoutTemplate,
  overview: LayoutDashboard,
  members: Users,
  feedback: MessageSquareHeart,
  // 锁形图标，与顶栏切到本地组织时的那把锁是同一个符号——同一件事在两处要看起来是同一件事
  local: Lock,
};

/**
 * 后台左栏 —— 两组（AI 能力 / 组织）。纯展示 + Link，靠 active 高亮。
 *
 * ⚠ 「AI 能力」组的**项集合**不是随手写的：它必须与契约 `AssetKind` 的取值集合
 * **双向相等**（asset-governance I-2），门控在 `./asset-kind-nav.ts` + `tests/ui/
 * admin-nav-asset-kinds-bijective.test.tsx`。删一项 / 多一项 / 契约加值没跟，都会红。
 *
 * ⚠ **每一项后面带一个数字（F133 / I-24）**：数字来自 `resolveAdminNavCounts`，
 * 逐项独立求值——某一类计数查询挂了，只有那一项显示「—」，其余项照常显示数字，
 * 左栏不会整个空掉。「—」与 `0` 在界面上是两件事，详见 `lib/admin-nav-counts.ts`
 * 顶部的长注：`0` 是「这类资产一个都没有」，「—」是「这个数现在取不到」。
 *
 * ## #593 —— 第三组「能力域 · 全生命周期」
 *
 * 原型（`phases/requirements/WorkspaceX Standalone.html`）的一级导航「治理」只有「后台」
 * 一项；蓝本 / 技能 / 智能体 / 成员 / 资产在原型里是**后台模块**（COLUMN 2）。
 * 2026-07-30 的接线修正为了让十一束现行屏可达，把它们直接塞进了一级——可达性修好了，
 * 信息架构被压平了。这里把它们作为后台的**二级**渲染出来：**入口只此一处**，
 * 一级导航里已经没有了，不是「界面上没有但 DOM 里还在」的僵尸。
 * 清单的唯一事实源是 `lib/navigation.ts` 的 `ADMIN_SECOND_LEVEL`，这里不抄第二份。
 *
 * ⚠ 已知重复（**先前就有，本 PR 不裁**）：上面「AI 能力 / 组织」组的
 *   Agent · Skill · 项目蓝本 · 成员配额 指向 `/admin/*` 那批**接了真实数据**的屏，
 *   而第三组指向的是同名能力域的 UI 先行全生命周期屏（多为 mock）。
 *   两者是同一件事的两套实现，归并需要人裁——本 PR 只把入口从一级收回后台。
 *
 * ## #700 —— 「原型 · 待归并」标签（人类裁决选项 1）
 *
 * 上面这条「已知重复」曾经只写在注释里，用户在界面上看不出这组入口是原型。
 * #700 issue #700#issuecomment-5224610781 人类选了选项 1：**不删这组入口**
 * （删了会打红 `lint-nav-reachability.mjs`，也会让 ADR-023 签核材料不可达），
 * 但要在 UI 上诚实标出「这是原型，不是跟『AI 能力』组重复的另一套正式功能」。
 * 于是这里逐项渲染 `item.isPrototype`（唯一事实源见 `lib/navigation.ts` 的
 * `ADMIN_SECOND_LEVEL`）驱动的 `Badge`——`skills`（已接真实后端）不带该字段，
 * 不与其余四项连坐；语气对齐 `NoBackendNotice`「尚未接入真实后端」。
 *
 * `countSources` 默认取生产数据源（`ADMIN_NAV_COUNT_SOURCES`）；测试用它注入
 * 会抛错的来源做反证（见 `tests/ui/admin-nav-count-unavailable.test.tsx`），
 * 不需要 mock 整个模块。
 */
/** 左栏全部项的 key，顺序与 `ADMIN_NAV` 一致。 */
const ALL_NAV_KEYS: AdminModuleKey[] = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key));

export function AdminNav({
  active,
  countSources,
}: {
  active: AdminModuleKey;
  /**
   * #881：缺省**不再是** `lib/mock/admin.ts` 的静态 mock，而是当前组织的真实计数。
   *
   * 之前左栏写「Skill 11」而 Skill 目录页写「共 5 条」，就是因为这里默认吃 mock。
   * 口径明确的两项（agent / skill）取真实 `GET /capabilities`，其余项口径「待 Q-11」
   * 未裁决 ⇒ 一律「—」，**不编数字**（见 `lib/live-admin-nav-counts.ts` 头注）。
   *
   * 这个 prop 保留给测试注入（包括注入会抛错的来源做反证）。
   */
  countSources?: Record<AdminModuleKey, AdminNavCountSource>;
}) {
  // ⚠ `useOptionalSession` 而不是 `useSession`：本组件在若干测试里被裸渲染（无 Provider），
  //   `useSession` 会直接抛。没有会话 ⇒ 拿不到 orgId ⇒ 计数「—」，这本身就是诚实的答案。
  const session = useOptionalSession();
  const liveSources = useLiveAdminNavCounts(session?.session?.currentOrgId ?? null, ALL_NAV_KEYS);
  const counts = resolveAdminNavCounts(countSources ?? liveSources);
  return (
    <nav aria-label="后台模块" data-testid="admin-nav" className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-0.5 px-1">
        <span className="text-13 font-semibold">治理后台</span>
        <span className="text-11 text-muted-foreground">AI 能力与组织的管理面</span>
      </div>
      {ADMIN_NAV.map((group) => (
        <div key={group.group} className="flex flex-col gap-1">
          <span className="select-none px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">
            {group.group}
          </span>
          {group.items.map((item) => {
            const Icon = ICONS[item.key];
            const isActive = item.key === active;
            const count = counts[item.key];
            const countUnavailable = count === "—";
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={ADMIN_NAV_TESTID[item.key]}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-all duration-200",
                  isActive
                    ? "bg-card font-medium text-background-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                <span
                  data-testid={`${ADMIN_NAV_TESTID[item.key]}-count`}
                  aria-label={countUnavailable ? `${item.label} 计数暂不可用` : `${item.label} 共 ${count} 项`}
                  /**
                   * #881：告诉用户「—」是什么意思。
                   *
                   * 本 issue 把 agent/skill 接上真实计数后，其余项从"有一个 mock 数字"
                   * 变成「—」——这是用户可见的变化，不解释就会被当成故障。
                   * ⚠ 这句话只说**事实**（这一项还没接真实数据源），不承诺什么时候接，
                   *   也不假装它是 0。
                   */
                  title={countUnavailable ? `${item.label}：尚未接入真实数据源，因此不显示数字（不是 0）` : undefined}
                  className={cn(
                    "shrink-0 text-11 tabular-nums",
                    countUnavailable ? "text-muted-foreground/60" : "text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      ))}

      {/* #593 后台二级模块 —— 说明见本文件头注「#593」一节。 */}
      {ADMIN_SECOND_LEVEL.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="select-none px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">
            能力域 · 全生命周期
          </span>
          {ADMIN_SECOND_LEVEL.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={adminSubNavTestId(item.key)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-12 text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-background-foreground"
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.isPrototype && (
                  <Badge
                    tone="warning"
                    data-testid={`${adminSubNavTestId(item.key)}-prototype-badge`}
                    aria-label={`${item.label}：原型演示，尚未与「AI 能力」组的正式功能归并`}
                    className="shrink-0"
                  >
                    原型 · 待归并
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
