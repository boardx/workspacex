"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SEGMENTS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * 图标栏 —— 实测宽度 76px，底色 --rail，右侧一道 --border 分隔。
 *
 * ⚠ 这里**只渲染 `NavSegment.items`（一级）**，永不渲染 `item.children`（二级）——
 *   这是一级/二级的机械分界（issue #593）。二级由后台左栏 `components/admin/admin-nav.tsx`
 *   渲染。想让某个入口回到一级，去 `lib/navigation.ts` 把它挪出 children，
 *   不要在这里加一条渲染 children 的分支——那会让同一个入口在两处出现。
 */
export function IconRail({ avatarInitial }: { avatarInitial: string }) {
  const pathname = usePathname();
  return (
    <nav
      data-testid="shell-rail"
      aria-label="主导航"
      className="flex w-rail min-w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-3.5"
    >
      <Link
        href="/"
        data-testid="rail-home"
        aria-label="回到首页"
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-inverse text-14 font-semibold text-inverse-foreground transition-all duration-200 hover:bg-inverse/90"
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

      <div
        data-testid="rail-avatar"
        className="mt-auto flex h-7 w-7 items-center justify-center rounded-full bg-accent text-11 font-medium text-accent-foreground"
      >
        {avatarInitial}
      </div>
    </nav>
  );
}
