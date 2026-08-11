"use client";
import * as React from "react";
import Link from "next/link";
import { BrainCircuit, LogOut, User } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

/**
 * 左下角头像 → 个人菜单（下拉，2026-08-09 信息架构调整）。
 *
 * 此前是直接 `<Link href="/profile">`——点头像只能到个人资料一处。现在头像是菜单触发器，
 * 抄 `components/projects/project-more-menu.tsx` 的下拉写法（本仓没有 `components/ui/`
 * 下的 dropdown/popover 组件，这是仓库里唯一已有的下拉模式，跟随它，不发明新的一套）。
 *
 * 菜单项：
 *   - 个人资料 → `/profile`（不变）
 *   - 个人 Brain → `/brain`——**这是「个人记忆管理」与「个人大脑」合并后的唯一入口**。
 *     仓库里没有独立的「个人记忆」契约/页面，硬造一个会是没有后端支撑的假入口。
 *   - 主题切换 → 见 `theme-toggle.tsx`。
 *   - 退出 → 从顶栏挪过来（原来顶栏单独有一个 `session-logout` 按钮，同一功能不许
 *     两个入口，顶栏那份已删）。`onLogout` 在没有真实 session 的旧版原型页
 *     （`AppShell` 的 `identity` 直传分支）里不存在，此时不渲染这一项。
 */
export function PersonalMenu({
  avatarInitial, onLogout,
}: { avatarInitial: string; onLogout?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-auto">
      <button
        type="button"
        data-testid="rail-profile-menu"
        aria-label="个人菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-11 font-medium text-accent-foreground transition-all duration-200 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span data-testid="rail-avatar" aria-hidden>{avatarInitial}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="个人菜单"
          data-testid="rail-personal-menu"
          className="absolute bottom-0 left-[calc(100%+8px)] z-20 w-48 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          <MenuLink href="/profile" testId="personal-menu-profile" icon={User}>个人资料</MenuLink>
          <MenuLink href="/brain" testId="personal-menu-brain" icon={BrainCircuit}>个人 Brain</MenuLink>
          <div className="my-1 h-px bg-border" aria-hidden />
          <ThemeToggle testId="personal-menu-theme" />
          {onLogout && (
            <>
              <div className="my-1 h-px bg-border" aria-hidden />
              <button
                type="button"
                role="menuitem"
                data-testid="personal-menu-logout"
                onClick={() => { setOpen(false); onLogout(); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 text-destructive",
                  "transition-colors duration-200 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                <LogOut aria-hidden className="h-3.5 w-3.5" />
                退出
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  function MenuLink({
    href, testId, icon: Icon, children,
  }: { href: string; testId: string; icon: typeof User; children: React.ReactNode }) {
    return (
      <Link
        href={href}
        role="menuitem"
        data-testid={testId}
        onClick={() => setOpen(false)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-12 text-card-foreground transition-colors duration-200 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {children}
      </Link>
    );
  }
}
