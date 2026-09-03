"use client";

import Link from "next/link";
import { Bot, Boxes, Cpu, Plug, Shapes, LayoutTemplate, LayoutDashboard, Users, MessageSquareHeart, Lock, Globe, Settings, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { ADMIN_NAV, ADMIN_MODULE_SCOPE, ADMIN_SCOPE_META, adminNavForScope, type AdminModuleKey, type AdminScope } from "@/lib/mock/admin";
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
  // 与左上角组织菜单「组织管理」入口（`org-menu.tsx`）同一个符号——同一件事在两处
  // 要看起来是同一件事。
  "org-profile": Settings,
  members: Users,
  feedback: MessageSquareHeart,
  // 心跳/活跃度符号——「运营状态」是运维自查这个部署本身是否健康的工具，与「反馈」
  // （处理用户提交的内容）刻意不同符号。
  "ops-status": Activity,
  // 锁形图标，与顶栏切到本地组织时的那把锁是同一个符号——同一件事在两处要看起来是同一件事
  local: Lock,
  // 地球：跨组织的全平台视角，与「组织」组的 Users（一个组织里的人）刻意不同符号。
  platform: Globe,
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
 * ## #593 —— 第三组「能力域 · 全生命周期」（2026-08-11 起：真合并后基本已清空）
 *
 * 原型（`phases/requirements/WorkspaceX Standalone.html`）的一级导航「治理」只有「后台」
 * 一项；蓝本 / 技能 / 智能体 / 成员 / 资产在原型里是**后台模块**（COLUMN 2）。
 * 2026-07-30 的接线修正为了让十一束现行屏可达，把它们直接塞进了一级——可达性修好了，
 * 信息架构被压平了。这里把它们作为后台的**二级**渲染出来：**入口只此一处**，
 * 一级导航里已经没有了，不是「界面上没有但 DOM 里还在」的僵尸。
 * 清单的唯一事实源是 `lib/navigation.ts` 的 `ADMIN_SECOND_LEVEL`，这里不抄第二份。
 *
 * ⚠ 2026-08-11 人类直接裁决（原话：「这些都是重复的目录，要把它整合在一起，不要有
 *   重复的」）：#700/#928/#929 那几轮只是改措辞、加徽标、加跳转链接，从未真的合并。
 *   这次是**真合并**——蓝本 / Skill 库与市场 / 智能体运行时 / 资产 / 画布五项已经
 *   在 `MERGED_SECOND_LEVEL_KEYS` 里被摘出渲染，各自新落点见 `lib/navigation.ts`
 *   `ADMIN_SECOND_LEVEL` 里每一项的注释。
 *   ⚠ 2026-08-14（#1168）：最后剩下的「组织成员」也被人类点名合并，这一组因此
 *   **一项都不再渲染**——但数组本身仍在，见下方 `MERGED_SECOND_LEVEL_KEYS` 的长注。
 *
 * `countSources` 默认取生产数据源（`ADMIN_NAV_COUNT_SOURCES`）；测试用它注入
 * 会抛错的来源做反证（见 `tests/ui/admin-nav-count-unavailable.test.tsx`），
 * 不需要 mock 整个模块。
 */
/** 左栏全部项的 key，顺序与 `ADMIN_NAV` 一致。 */
const ALL_NAV_KEYS: AdminModuleKey[] = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key));

/**
 * 2026-08-11（人类直接裁决，真合并）：这五个键已经找到各自的真实新落点
 * （见 `lib/navigation.ts` 的 `ADMIN_SECOND_LEVEL` 里每一项各自的注释），
 * 不再在「能力域 · 全生命周期」这个第二组里渲染出第二个入口。
 *
 * ⚠ 它们仍然**留在** `ADMIN_SECOND_LEVEL`（`lib/navigation.ts`）数组里——那个数组是
 * `lint-nav-reachability.mjs` 判定「束的现行路由是否可达」时唯一会扫描到的文本来源，
 * 删掉数组项会让门控把 `/tpl` `/skill` `/preview/agent-runtime` `/asset-governance`
 * `/canvas` 判成不可达（即使它们其实从别处能点到）。这里只过滤**渲染**，不改数据源，
 * 「数组仍声明 href、但不再画出第二个菜单项」是刻意的两件事分开做。
 */
/*
 * 2026-08-14（#1168，人类截图实测后直接裁决）：`org-admin`（「组织成员」）加入本集合。
 *
 * ⚠ 这个键此前被明确排除在外，理由写在本文件与 `lib/navigation.ts` 两处：
 *   「人类本轮原话没有点名『组织』这一项……不在本轮改动」。那句话记录的是
 *   **当时人类没点名**，不是「这件事不该做」——现在点名了，条件变了。
 *   （把它当成「已裁决为不做」而不再复查，正是 AGENTS.md 那条「静态痕迹 ≠ 动态事实」：
 *   一句写下来就不会再变的注释，读起来像一条永久裁决。）
 *
 * 新落点：「成员配额」屏内的 `[打开组织成员管理]` 链接（`admin-members-open-org-admin`）
 * —— 与上面五项同一形态：入口只留一个，且留在与它语义最近的那块屏里。
 */
/*
 * 2026-08-26：`agent-interrupts` / `plan-control` 加入本集合——但理由与上面六项**不同**，
 * 不要误读成「又发现两个重复入口」：
 *
 * 这两个键**不是**「能力域·全生命周期」组的重复项，它们是签核用的 v2 静态原型屏
 * （`/preview/agent-interrupts`、`/preview/plan-control`，ADR-023 第①件材料），本轮
 * 只出契约（`packages/contracts/src/{agent-interrupts,plan-control}.ts`），未接实现——
 * 落地后会挂进 `/chat`，不属于后台「治理」范畴，从一开始就不该在这里画出一个菜单项。
 * 留在 `ADMIN_SECOND_LEVEL` 数组里的理由与上面六项一样：`lint-nav-reachability.mjs`
 * 判「束的现行路由是否可达」唯一会扫描的文本来源在那个数组，删掉会让门控把这两个
 * 预览屏判成不可达。见 `lib/navigation.ts` 里这两项各自的注释。
 */
const MERGED_SECOND_LEVEL_KEYS = new Set<string>([
  "templates", "skills", "agent-runtime", "asset-governance", "canvas", "org-admin",
  "agent-interrupts", "plan-control",
]);

export function AdminNav({
  active,
  scope,
  countSources,
}: {
  active: AdminModuleKey;
  /**
   * 2026-09-02 后台切成两面（`AdminScope`，见 `lib/mock/admin.ts`）：左栏**只画自己这一面**的组。
   * 不传时按 `active` 所属的面推断——调用方通常不必写。
   */
  scope?: AdminScope;
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
  const resolvedScope: AdminScope = scope ?? ADMIN_MODULE_SCOPE[active];
  const scopeMeta = ADMIN_SCOPE_META[resolvedScope];
  // 「能力域 · 全生命周期」二级组是组织后台的东西（束的现行屏全部是组织级），平台面不画。
  const secondLevelVisible = resolvedScope === "org"
    ? ADMIN_SECOND_LEVEL.filter((item) => !MERGED_SECOND_LEVEL_KEYS.has(item.key))
    : [];
  return (
    <nav
      aria-label={`${scopeMeta.title}模块`}
      data-testid="admin-nav"
      data-admin-scope={resolvedScope}
      className="flex flex-col gap-4 p-3"
    >
      <div className="flex flex-col gap-0.5 px-1">
        <span className="text-13 font-semibold" data-testid="admin-nav-title">{scopeMeta.title}</span>
        <span className="text-11 text-muted-foreground">{scopeMeta.intro}</span>
      </div>
      {adminNavForScope(resolvedScope).map((group) => (
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

      {/* #593 后台二级模块 —— 说明见本文件头注「#593」一节。2026-08-11：五个真合并的重复项
          已从这里过滤掉（`MERGED_SECOND_LEVEL_KEYS`），这一组现在只剩「组织成员」一项。 */}
      {secondLevelVisible.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="select-none px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">
            能力域 · 全生命周期
          </span>
          {secondLevelVisible.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="flex flex-col gap-0.5">
                <Link
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
                      aria-label={`${item.label}：预览，尚未接入真实后端`}
                      className="shrink-0"
                    >
                      预览 · 未接后端
                    </Badge>
                  )}
                </Link>
                {/* #700 后续修法：不再用一句模糊的「待归并」打发——每个原型项在标签下方
                    显式说清楚它和「AI 能力/组织」组哪一项对应、差异是什么（见 navigation.ts
                    的 prototypeNote 长注）。看得见，不需要 hover。 */}
                {item.isPrototype && item.prototypeNote && (
                  <p
                    data-testid={`${adminSubNavTestId(item.key)}-prototype-note`}
                    className="px-2 text-10 leading-snug text-muted-foreground/80"
                  >
                    {item.prototypeNote}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
