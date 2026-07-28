import Link from "next/link";
import { Bot, Boxes, Cpu, Plug, LayoutDashboard, Users, MessageSquareHeart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { cn } from "@/lib/utils";

const ICONS: Record<AdminModuleKey, LucideIcon> = {
  agent: Bot,
  skill: Boxes,
  model: Cpu,
  mcp: Plug,
  overview: LayoutDashboard,
  members: Users,
  feedback: MessageSquareHeart,
};

/** 后台左栏 —— 两组共 7 个模块（AI 能力 / 组织）。纯展示 + Link，靠 active 高亮。 */
export function AdminNav({ active }: { active: AdminModuleKey }) {
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
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={`admin-nav-${item.key}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-all duration-200",
                  isActive
                    ? "bg-card font-medium text-background-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
