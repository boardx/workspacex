"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SEGMENTS } from "@/lib/navigation";
import { PersonalMenu } from "./personal-menu";
import { cn } from "@/lib/utils";

/**
 * 图标栏 —— 实测宽度 76px，底色 --rail，右侧一道 --border 分隔。
 *
 * ⚠ 这里**只渲染 `NavSegment.items`（一级）**，永不渲染 `item.children`（二级）——
 *   这是一级/二级的机械分界（issue #593）。二级由后台左栏 `components/admin/admin-nav.tsx`
 *   渲染。想让某个入口回到一级，去 `lib/navigation.ts` 把它挪出 children，
 *   不要在这里加一条渲染 children 的分支——那会让同一个入口在两处出现。
 *
 * ⚠ 左上角 `X` logo（2026-08-09 信息架构调整）：**唯一**的组织管理入口，`data-testid`
 *   沿用 PR #736 建的 `org-admin-entry`（原来挂在顶栏一个独立的文字/图标链接上，现在挪
 *   到这里——同一功能不许两个入口，顶栏那份已删）。原来点它回首页（`href="/"`），现在
 *   首页导航不需要这个入口兼任，直接把它换成组织管理入口。
 */
export function IconRail({ avatarInitial, onLogout }: { avatarInitial: string; onLogout?: () => void }) {
  const pathname = usePathname();
  return (
    <nav
      data-testid="shell-rail"
      aria-label="主导航"
      className="flex w-rail min-w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-3.5"
    >
      <Link
        href="/org-admin"
        data-testid="org-admin-entry"
        aria-label="组织管理"
        title="组织管理"
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-inverse text-14 font-semibold text-inverse-foreground transition-all duration-200 hover:bg-inverse/90 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        X
      </Link>

      {NAV_SEGMENTS.map((seg, i) => (
        <div key={seg.label ?? `seg-${i}`} className="flex w-full flex-col items-center">
          {seg.label && (
            <span className="mt-3 select-none text-9 font-medium uppercase tracking-wide text-muted-foreground">
              {seg.label}
            </span>
          )}
          {seg.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={`rail-${item.key}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mt-1.5 flex w-14 flex-col items-center gap-1 rounded-md py-1.5 transition-all duration-200",
                  active
                    ? "bg-card text-background-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
                )}
              >
                <Icon aria-hidden className="h-4 w-4" />
                <span className="text-10">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      {/*
        个人菜单入口（#638 delta 迭代 1 建、2026-08-09 改成下拉）—— 固定在左下角，
        rubric 硬性锚点。`data-testid="rail-profile-menu"`/`"rail-avatar"` 沿用旧名，
        既有测试可能锚定；下拉本体见 `personal-menu.tsx`。
      */}
      <PersonalMenu avatarInitial={avatarInitial} onLogout={onLogout} />
    </nav>
  );
}
