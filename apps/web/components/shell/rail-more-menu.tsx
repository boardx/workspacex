"use client";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import type { NavSegment } from "@/lib/navigation";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * 图标栏底部的「更多」三点菜单（2026-09-30 人类直接要求：只把最重要的常驻，其余收进三点菜单）。
 *
 * 菜单里放 `NavItem.overflow === true` 的一级入口，按原来的五段分组（编排 / STUDIO / 能力 …）
 * 加小标题，分组与顺序不变——只是不再常驻图标栏。每个入口只在一处渲染（栏内或这里），
 * testid 仍是 `rail-<key>`，只是要先点开菜单才在 DOM 里。
 *
 * 当前页恰好是被收纳的入口时，三点按钮本身高亮（`aria-current`），避免「我在哪」在栏上消失。
 */
export function RailMoreMenu({
  segments, pathname,
}: { segments: ReadonlyArray<NavSegment>; pathname: string }) {
  const groups = segments
    .map((seg) => ({ label: seg.label, items: seg.items.filter((i) => i.overflow === true) }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  const isActive = (href: string) => {
    const path = href.split("?")[0]!;
    return pathname === path || pathname.startsWith(path + "/");
  };
  const anyActive = groups.some((g) => g.items.some((i) => isActive(i.href)));

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="rail-more"
          aria-label="更多"
          aria-current={anyActive ? "page" : undefined}
          className={cn(
            "mt-1.5 flex w-14 shrink-0 flex-col items-center gap-1 rounded-md py-1.5 transition-all duration-base",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            "[@media(max-height:640px)]:mt-1 [@media(max-height:640px)]:gap-0 [@media(max-height:640px)]:py-1",
            anyActive
              ? "bg-card text-background-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
          )}
        >
          <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          <span className="text-10 [@media(max-height:640px)]:hidden">更多</span>
        </button>
      </MenuTrigger>
      <MenuContent
        side="right"
        align="end"
        sideOffset={8}
        aria-label="更多入口"
        data-testid="rail-more-menu"
        className="max-h-[calc(100vh-2rem)] w-52 overflow-y-auto"
      >
        {groups.map((g, gi) => (
          <div key={g.label ?? `g-${String(gi)}`} role="group" aria-label={g.label ?? undefined}>
            {gi > 0 ? <MenuSeparator /> : null}
            {g.label ? <MenuLabel className="text-10 uppercase tracking-wide text-muted-foreground">{g.label}</MenuLabel> : null}
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <MenuItem key={item.key} asChild>
                  <Link
                    href={item.href}
                    data-testid={`rail-${item.key}`}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cn("gap-2", isActive(item.href) && "bg-muted font-medium")}
                  >
                    <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                  </Link>
                </MenuItem>
              );
            })}
          </div>
        ))}
      </MenuContent>
    </Menu>
  );
}
