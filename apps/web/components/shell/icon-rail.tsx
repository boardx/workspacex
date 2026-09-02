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
      className="flex h-full min-h-0 w-rail min-w-rail shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-border bg-rail py-3.5"
    >
      {/*
        2026-08-27 人类直接反馈（devapp 实测截图）：F19 品牌锚点（衬线体 "W"）与组织菜单
        头像/首字标识在视觉上重复——同一角落两个"这是什么身份"的标记，读作噪音而不是
        信息。组织菜单本身已经承担"这是哪个组织/点开能切换"的身份识别职责，删掉这个
        纯展示、不可点击的品牌字标，不影响任何交互（组织切换入口原样保留在下面）。
      */}
      {/*
        短视口策略（2026-09-02 人类直接反馈：窗口高度不够时菜单被挤出、左下角头像看不见）：
        rail 分三段——① 顶部组织菜单（shrink-0，永远可见）② 中段一级导航（min-h-0 +
        flex-1 + overflow-y-auto，高度不够时在段内滚动，滚动条隐藏、上下留渐隐提示）
        ③ 底部反馈 + 个人菜单（shrink-0，永远钉在左下角，rubric 硬性锚点）。
        再配一档紧凑模式：视口高度 ≤ 640px 时隐藏分组标题与图标下方文字（`max-h` 媒体查询
        arbitrary variant），只留图标 + title 提示，让更多项在不滚动时可见。
        不做"折进 more 菜单"的方案：那会让一级入口在两处出现（#593 一级/二级机械分界）。
      */}
      <div className="mb-2 shrink-0" data-testid="rail-top">
        <OrgMenu
          identity={identity}
          organizations={organizations}
          onSelect={onSwitchOrganization}
          switching={switching}
          placement="right"
        />
      </div>

      <div
        data-testid="rail-scroll"
        className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)]"
      >
      {NAV_SEGMENTS.map((seg, i) => (
        <div key={seg.label ?? `seg-${i}`} className="flex w-full shrink-0 flex-col items-center">
          {seg.label && (
            <span className="mt-3 select-none text-9 font-medium uppercase tracking-wide text-muted-foreground [@media(max-height:640px)]:hidden">
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
                title={item.label}
                className={cn(
                  "mt-1.5 flex w-14 shrink-0 flex-col items-center gap-1 rounded-md py-1.5 transition-all duration-base",
                  "[@media(max-height:640px)]:mt-1 [@media(max-height:640px)]:gap-0 [@media(max-height:640px)]:py-1",
                  active
                    ? "bg-card text-background-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
                )}
              >
                <Icon aria-hidden className="h-4 w-4" />
                <span className="text-10 [@media(max-height:640px)]:hidden">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
      </div>

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
      <div className="flex w-full shrink-0 flex-col items-center" data-testid="rail-bottom">
        <FeedbackButton
          target={{ kind: "product" }}
          targetLabel={null}
          variant="rail"
          className="[@media(max-height:640px)]:mt-1 [@media(max-height:640px)]:gap-0 [@media(max-height:640px)]:py-1 [@media(max-height:640px)]:[&>span]:hidden"
        />

      {/*
        个人菜单入口（#638 delta 迭代 1 建、2026-08-09 改成下拉）—— 固定在左下角，
        rubric 硬性锚点。`data-testid="rail-profile-menu"`/`"rail-avatar"` 沿用旧名，
        既有测试可能锚定；下拉本体见 `personal-menu.tsx`。
      */}
        <PersonalMenu avatarInitial={avatarInitial} onLogout={onLogout} />
      </div>
    </nav>
  );
}
