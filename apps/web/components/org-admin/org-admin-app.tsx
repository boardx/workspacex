"use client";
import * as React from "react";
import {
  Link2, Users, Eye, KeyRound, ShieldAlert, UserPlus, DoorOpen,
} from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { UI_STATE_LABEL } from "@/lib/ui-state";
import type { UiState } from "@/lib/ui-state";
import type { Identity, ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  ORG_ADMIN_SCREENS, ORG_ADMIN_SCREEN_LABEL, ORG_ADMIN_SCREEN_UC,
  type OrgAdminScreen,
} from "@/lib/mock/org-admin";
import { InvitesScreen } from "./invites-screen";
import { RosterScreen } from "./roster-screen";
import { RolesScreen } from "./roles-screen";
import { GrantScreen } from "./grant-screen";
import { BoundaryScreen } from "./boundary-screen";
import { MembersScreen } from "./members-screen";
import { ActivateScreen } from "./activate-screen";

const SCREEN_ICON: Record<OrgAdminScreen, React.ComponentType<{ className?: string }>> = {
  invites: Link2,
  roster: Users,
  roles: Eye,
  grant: KeyRound,
  boundary: ShieldAlert,
  members: UserPlus,
  activate: DoorOpen,
};

/**
 * org-admin 原型编排 —— UC-1.3 / 1.4 / 1.6 的所有屏经 `?screen=` 切换。
 *
 * 三栏骨架沿用已确认的 AppShell（左导航 / 中内容），与既有 files / admin 一致。
 * `activate`（激活落地页）是**免登上下文**，按 UC-1.6 R8「不复用后台」独立居中呈现。
 * `?as=`（视角）、`?state=`（七态）是**预览手段**，真实权限在服务端 NestJS Guard + RLS。
 */
export function OrgAdminApp({
  identity, previewRole, uiState, screen, qs,
}: {
  identity: Identity;
  previewRole: ProjectRole;
  uiState: UiState;
  screen: OrgAdminScreen;
  qs: { as?: string; org?: string };
}) {
  const href = (o: Partial<{ as: string; state: string; screen: string }>) => {
    const p = new URLSearchParams();
    const sc = o.screen ?? screen;
    if (sc && sc !== "invites") p.set("screen", sc);
    const as = o.as ?? qs.as;
    if (as && as !== "facilitator") p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    const st = o.state ?? uiState;
    if (st && st !== "default") p.set("state", st);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const body = (() => {
    switch (screen) {
      case "invites": return <InvitesScreen state={uiState} previewRole={previewRole} />;
      case "roster": return <RosterScreen state={uiState} previewRole={previewRole} />;
      case "roles": return <RolesScreen state={uiState} previewRole={previewRole} href={href} />;
      case "grant": return <GrantScreen state={uiState} previewRole={previewRole} />;
      case "boundary": return <BoundaryScreen state={uiState} />;
      case "members": return <MembersScreen state={uiState} previewRole={previewRole} />;
      case "activate": return <ActivateScreen state={uiState} />;
    }
  })();

  const controls = (
    <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} />
  );

  // 激活落地页：免登上下文，不套后台三栏
  if (screen === "activate") {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <div className="border-b border-border-subtle bg-panel-alt px-3 py-2">{controls}</div>
        <div className="flex flex-1 items-center justify-center p-4">{body}</div>
      </div>
    );
  }

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<OrgAdminNav href={href} screen={screen} />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border-subtle bg-panel-alt px-3 py-2">{controls}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </div>
    </AppShell>
  );
}

/* ── 左栏导航（屏切换，按 UC 分组标注载体） ─────────────────────────── */

function OrgAdminNav({
  href, screen,
}: {
  href: (o: Partial<{ screen: string }>) => string;
  screen: OrgAdminScreen;
}) {
  return (
    <nav className="flex flex-col gap-1 p-3" data-testid="org-admin-nav">
      <p className="px-1 pb-1 text-10 uppercase tracking-wide text-muted-foreground">
        组织与成员管理
      </p>
      {ORG_ADMIN_SCREENS.map((s) => {
        const Icon = SCREEN_ICON[s];
        const active = s === screen;
        return (
          <a
            key={s}
            href={href({ screen: s })}
            data-testid={`org-admin-nav-${s}`}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="text-13 font-medium">{ORG_ADMIN_SCREEN_LABEL[s]}</span>
              <span className="text-10 text-muted-foreground">{ORG_ADMIN_SCREEN_UC[s]}</span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/* ── 预览控制条（屏 / 视角 / 七态）——仅 dev，生产不渲染 ───────────────── */

function PreviewControls({
  href, screen, uiState, qs,
}: {
  href: (o: Partial<{ as: string; state: string; screen: string }>) => string;
  screen: OrgAdminScreen;
  uiState: UiState;
  qs: { as?: string; org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "facilitator";
  return (
    <div className="flex flex-col gap-1.5" data-testid="org-admin-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {ORG_ADMIN_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="org-admin-screen-switch">
            <a href={href({ screen: s })}>{ORG_ADMIN_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {PROJECT_ROLES.map((r) => (
          <Button key={r} asChild size="xs" variant={currentAs === r ? "primary" : "ghost"} data-testid="org-admin-role-switch">
            <a href={href({ as: r })}>{PROJECT_ROLE_LABEL[r]}</a>
          </Button>
        ))}
        <Badge tone="outline" className="ml-1">预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatePreviewSwitcher current={uiState} />
        <span className="px-1 text-10 text-muted-foreground">当前：{UI_STATE_LABEL[uiState]}</span>
      </div>
    </div>
  );
}
