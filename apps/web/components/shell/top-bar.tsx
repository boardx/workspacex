"use client";
import { Building2, ChevronDown, FolderKanban } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  MOCK_ORGS, describeOrgLayer, describeProjectLayer,
  PROJECT_ROLES, PROJECT_ROLE_LABEL, type Identity, type ProjectRole,
} from "@/lib/identity";
import { resolveProjectContext } from "@/lib/project-context";
import { Button } from "@/components/ui/button";

/**
 * 顶部条 = 组织切换器（裁决 O-12）+ 两层角色说明条（UC-0.3 R8）
 *
 * O-12 要点：切换器顶部常驻、会话内切换不需重新登录；
 * **切换时必须清空全部项目级上下文**（当前项目/环节/Context Pack/鉴权缓存/未提交草稿）。
 *
 * ⚠ **项目层身份与视角切换器只在项目上下文内渲染**（2026-07-28 修正）。
 *   此前无条件渲染「本项目：引导师」，等于宣称项目角色是全局属性——与 UC-0.3 冲突：
 *   项目角色只对某个**目标项目**成立，R4 E1 明写「有组织角色但无项目角色」是正常状态。
 *   在后台/任务/大脑上显示项目角色，是把一个不存在的判定画到界面上。
 *   作用域判定见 `lib/project-context.ts`。
 *
 * ⚠ 视角切换器是**预览手段，不是权限实现**，且生产构建不可达（verify-prod-gates.sh 断言）。
 */
export function TopBar({
  identity, previewRole,
}: { identity: Identity; previewRole: ProjectRole | null }) {
  const pathname = usePathname();
  const project = resolveProjectContext(pathname);
  const isDev = process.env.NODE_ENV !== "production";
  const projectLayer = project ? describeProjectLayer(identity) : null;

  return (
    <header
      data-testid="shell-topbar"
      className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
    >
      {/* ── 组织层：全局常驻 ── */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Building2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <label htmlFor="org-switcher" className="sr-only">切换组织</label>
        <div className="relative">
          <select
            id="org-switcher"
            data-testid="org-switcher"
            defaultValue={identity.org.id}
            onChange={(e) => {
              // O-12：切换组织 = 清空全部项目级上下文，权限按新组织重新求值
              const url = new URL(window.location.href);
              url.searchParams.set("org", e.target.value);
              ["project", "stage", "pack"].forEach((k) => url.searchParams.delete(k));
              window.location.assign(url.toString());
            }}
            className="h-7 appearance-none rounded-md border border-border bg-card pl-2 pr-6 text-12 font-medium text-card-foreground transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {MOCK_ORGS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="h-4 w-px shrink-0 bg-border" aria-hidden />

      <p data-testid="role-bar-org" className="shrink-0 truncate text-12 text-muted-foreground">
        {describeOrgLayer(identity)}
      </p>

      {/* ── 项目层：只在项目上下文里出现 ── */}
      {project && (
        <>
          <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <div className="flex min-w-0 items-center gap-1.5" data-testid="topbar-project-context">
            <FolderKanban aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-12 font-medium">{project.name}</span>
            {projectLayer && (
              <span data-testid="role-bar-project" className="truncate text-12 text-muted-foreground">
                · {projectLayer}
              </span>
            )}
          </div>
        </>
      )}

      {/* ── 视角切换器：预览手段，同样只在项目里；生产不可达 ── */}
      {isDev && project && (
        <div
          data-testid="role-preview-switcher"
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-panel p-1 lg:flex"
        >
          <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">本项目视角</span>
          {PROJECT_ROLES.map((r) => (
            <Button key={r} asChild size="xs" variant={r === previewRole ? "primary" : "ghost"} data-testid={`role-switch-${r}`}>
              <a href={`?as=${r}`}>{PROJECT_ROLE_LABEL[r]}</a>
            </Button>
          ))}
        </div>
      )}

      {/* 不在项目里时给一句解释，而不是留白——「无项目角色」是正常状态，不是缺失 */}
      {!project && (
        <p className="ml-auto hidden shrink-0 text-10 text-muted-foreground lg:block" data-testid="topbar-no-project-hint">
          不在项目上下文中 · 项目角色不适用
        </p>
      )}
    </header>
  );
}
