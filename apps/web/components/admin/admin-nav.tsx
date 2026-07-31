import Link from "next/link";
import { Bot, Boxes, Cpu, Plug, Shapes, LayoutTemplate, LayoutDashboard, Users, MessageSquareHeart, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ADMIN_NAV, ADMIN_NAV_COUNT_SOURCES, type AdminModuleKey } from "@/lib/mock/admin";
import { ADMIN_NAV_TESTID } from "./asset-kind-nav";
import { resolveAdminNavCounts, type AdminNavCountSource } from "@/lib/admin-nav-counts";
import { cn } from "@/lib/utils";

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
 * `countSources` 默认取生产数据源（`ADMIN_NAV_COUNT_SOURCES`）；测试用它注入
 * 会抛错的来源做反证（见 `tests/ui/admin-nav-count-unavailable.test.tsx`），
 * 不需要 mock 整个模块。
 */
export function AdminNav({
  active,
  countSources = ADMIN_NAV_COUNT_SOURCES,
}: {
  active: AdminModuleKey;
  countSources?: Record<AdminModuleKey, AdminNavCountSource>;
}) {
  const counts = resolveAdminNavCounts(countSources);
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
    </nav>
  );
}
