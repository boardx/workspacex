"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SEGMENTS } from "@/lib/navigation";
import type { Identity } from "@/lib/identity";
import { OrgMenu } from "./org-menu";
import { PersonalMenu } from "./personal-menu";
import { cn } from "@/lib/utils";
import { FeedbackButton } from "@/components/feedback/feedback-button";

/**
 * 图标栏 —— 实测宽度 76px，底色 --rail，右侧一道 --border 分隔。
 *
 * ⚠ 这里**只渲染 `NavSegment.items`（一级）**，永不渲染 `item.children`（二级）——
 *   这是一级/二级的机械分界（issue #593）。二级由后台左栏 `components/admin/admin-nav.tsx`
 *   渲染。想让某个入口回到一级，去 `lib/navigation.ts` 把它挪出 children，
 *   不要在这里加一条渲染 children 的分支——那会让同一个入口在两处出现。
 *
 * ⚠ 左上角（2026-08-11 信息架构调整，人类直接要求）：原黑底 `X` logo（点击直跳
 *   `/org-admin`）换成**组织菜单触发器**（`org-menu.tsx`）——组织头像/首字标识，
 *   点击弹菜单 = 切换组织 + 组织管理。`org-admin-entry` testid 挪到菜单里的
 *   「组织管理」项上，仍然是唯一的组织管理入口，只是从「点击直达」变成
 *   「点开菜单 → 点组织管理」；顶栏原独立组织切换器同轮删除（同一功能不许两个入口）。
 */
export function IconRail({
  identity, organizations, onSwitchOrganization, switching, avatarInitial, onLogout,
}: {
  identity: Identity;
  organizations: ReadonlyArray<{ id: string; label: string }>;
  onSwitchOrganization: (orgId: string) => void;
  switching?: boolean;
  avatarInitial: string;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav
      data-testid="shell-rail"
      aria-label="主导航"
      className="flex w-rail min-w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-3.5"
    >
      <div className="mb-2">
        <OrgMenu
          identity={identity}
          organizations={organizations}
          onSelect={onSwitchOrganization}
          switching={switching}
          placement="right"
        />
      </div>

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
        FB-2 反馈入口（D2，2026-08-15 人类裁决：图标栏常驻图标，不是顶栏下拉里的一项）。

        ⚠ 它「不是 `NAV_SEGMENTS` 的一项」，所以不在上面那个循环里——它是一个「动作」
          （打开弹层）而不是一个「目的地」（一条路由）。混进 NAV_SEGMENTS 会有两个后果：
          ① `lint-nav-reachability` 会要求它对应一个契约束的现行路由，而它没有路由；
          ② 它会拿到 `aria-current="page"` 的高亮逻辑，而一个动作永远不是当前页。

        ⚠ 位置在个人菜单「上方」、分组之外：反馈不属于「编排/STUDIO/能力/治理」任何一段，
          它是对整个产品说话。D2 的原话是「反馈这件事一旦要多点两下就没人提了」——
          所以它常驻，而不是折进某个菜单。
      */}
      <div className="mt-auto flex w-full flex-col items-center">
        <FeedbackButton target={{ kind: "product" }} targetLabel={null} variant="rail" />
      </div>

      {/*
        个人菜单入口（#638 delta 迭代 1 建、2026-08-09 改成下拉）—— 固定在左下角，
        rubric 硬性锚点。`data-testid="rail-profile-menu"`/`"rail-avatar"` 沿用旧名，
        既有测试可能锚定；下拉本体见 `personal-menu.tsx`。
      */}
      <PersonalMenu avatarInitial={avatarInitial} onLogout={onLogout} />
    </nav>
  );
}
