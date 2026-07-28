"use client";
import { Building2, ChevronDown } from "lucide-react";
import { MOCK_ORGS, describeIdentity, PROJECT_ROLES, PROJECT_ROLE_LABEL, type Identity, type ProjectRole } from "@/lib/identity";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 顶部条 = 组织切换器（裁决 O-12）+ 两层角色说明条（UC-0.3 R8）
 *
 * O-12 要点：切换器顶部常驻、会话内切换不需重新登录；
 * **切换时必须清空全部项目级上下文**（当前项目/环节/Context Pack/鉴权缓存/未提交草稿）。
 * ⚠ 此处为界面投影，真实的上下文清空与权限重求值在服务端。
 */
export function TopBar({
  identity, previewRole,
}: { identity: Identity; previewRole: ProjectRole | null }) {
  const isDev = process.env.NODE_ENV !== "production";
  return (
    <header
      data-testid="shell-topbar"
      className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
    >
      <div className="flex items-center gap-1.5">
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

      <div className="h-4 w-px bg-border" aria-hidden />

      <p data-testid="role-bar" className="text-12 text-muted-foreground">
        {describeIdentity(identity)}
      </p>

      {isDev && (
        <div
          data-testid="role-preview-switcher"
          className="ml-auto flex items-center gap-1 rounded-md border border-border-subtle bg-panel p-1"
        >
          <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">预览视角</span>
          {PROJECT_ROLES.map((r) => (
            <Button key={r} asChild size="xs" variant={r === previewRole ? "primary" : "ghost"} data-testid={`role-switch-${r}`}>
              <a href={`?as=${r}`}>{PROJECT_ROLE_LABEL[r]}</a>
            </Button>
          ))}
        </div>
      )}
    </header>
  );
}
