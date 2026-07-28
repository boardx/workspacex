"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, FolderKanban, ListTodo, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 移动端一级 tab —— 实测原型「同一信息架构，三栏折叠为三层」：
 *   一级 tab（对话 / 项目 / 任务 / 我）＋ 二级列表 ＋ 全屏推入 ＋ 抽屉
 * 只在 <md 显示；≥md 由 IconRail 承担导航。
 */
const TABS = [
  { key: "chat", label: "对话", href: "/chat", icon: MessagesSquare },
  { key: "projects", label: "项目", href: "/projects", icon: FolderKanban },
  { key: "tasks", label: "任务", href: "/tasks", icon: ListTodo },
  { key: "me", label: "我", href: "/brain", icon: User },
];

export function MobileTabs() {
  const pathname = usePathname();
  return (
    <nav
      data-testid="shell-mobile-tabs"
      aria-label="主导航（移动端）"
      className="flex h-14 shrink-0 items-stretch border-t border-border bg-card md:hidden"
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={t.href}
            data-testid={`mobile-tab-${t.key}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 transition-all duration-200",
              active ? "text-primary" : "text-muted-foreground hover:text-background-foreground",
            )}
          >
            <Icon aria-hidden className="h-5 w-5" />
            <span className="text-10">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
