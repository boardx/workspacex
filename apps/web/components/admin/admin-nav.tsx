import Link from "next/link";
import { Bot, Boxes, Cpu, Plug, Shapes, LayoutTemplate, LayoutDashboard, Users, MessageSquareHeart, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { ADMIN_NAV_TESTID } from "./asset-kind-nav";
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
 */
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
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
