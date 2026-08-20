"use client";
import * as React from "react";
import { Check, X, LayoutTemplate, FolderKanban } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { Identity, ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  TPL_SCREENS, TPL_SCREEN_LABEL, TPL_SCREEN_UC, type TplScreen,
} from "@/lib/mock/tpl";
import { BlueprintListScreen } from "./blueprint-list-screen";
import { DesignerScreen } from "./designer-screen";
import { ApplyWizardScreen } from "./apply-wizard-screen";
import { ProjectPrepScreen } from "./project-prep-screen";
import { WorkflowScreen } from "./workflow-screen";
import { PromoteScreen } from "./promote-screen";
import { VersionsScreen } from "./versions-screen";

/**
 * `tpl`（蓝本）能力域原型编排 —— 用已确认的三栏骨架 AppShell。
 * `screen`/`state`/`as` 走 URL 做预览切换；屏内交互走本地状态。
 * 视角切换（引导师/组长/组员/观察者）是**预览手段**，真实权限在服务端 RLS。
 */
export function TplApp({
  identity, previewRole, uiState, screen, qs,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  uiState: UiState;
  screen: TplScreen;
  qs: { as?: string; org?: string; projectId?: string };
}) {
  const [toast, setToast] = React.useState<string | null>(null);

  const href = (o: Partial<{ as: string; state: string; screen: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as) p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    // projectId 只由外部（页面 searchParams）灌入，本页内没有任何控件会改它——
    // 屏/角色/态切换时原样透传，否则切一次屏 workflow 屏就会丢掉真实项目上下文。
    if (qs.projectId) p.set("projectId", qs.projectId);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    // 裸参数省略的是"默认屏"："list"（F318：默认落地屏已从 designer 改为 list），
    // 不再是 "designer"——否则预览态"屏"切换器点「蓝本设计器」会因省略参数被误判成 list。
    const sc = o.screen ?? screen; if (sc && sc !== "list") p.set("screen", sc);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  const common = { uiState, previewRole, onToast: setToast };

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<TplNav screen={screen} href={href} />}>
      <div className="relative flex h-full min-h-0 flex-col">
        <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {screen === "list" && <BlueprintListScreen {...common} />}
          {screen === "designer" && <DesignerScreen {...common} />}
          {screen === "apply" && <ApplyWizardScreen {...common} />}
          {screen === "prep" && <ProjectPrepScreen {...common} />}
          {screen === "workflow" && <WorkflowScreen {...common} projectId={qs.projectId ?? null} />}
          {screen === "promote" && <PromoteScreen {...common} />}
          {screen === "versions" && <VersionsScreen {...common} />}
        </div>

        <TplToast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </AppShell>
  );
}

/* ── 左栏导航（后台 · 项目蓝本 / 项目 · 筹备 两组）──────────────────────── */

const NAV_GROUPS: { label: string; icon: typeof LayoutTemplate; screens: TplScreen[] }[] = [
  { label: "后台 · 项目蓝本", icon: LayoutTemplate, screens: ["list", "designer", "versions", "promote"] },
  { label: "项目 · 筹备", icon: FolderKanban, screens: ["apply", "prep", "workflow"] },
];

function TplNav({ screen, href }: { screen: TplScreen; href: (o: { screen: string }) => string }) {
  return (
    <nav className="flex flex-col gap-4 p-3" data-testid="tpl-nav">
      {NAV_GROUPS.map((g) => {
        const Icon = g.icon;
        return (
          <div key={g.label} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-1.5 text-10 uppercase tracking-wide text-muted-foreground">
              <Icon aria-hidden className="h-3 w-3" /> {g.label}
            </div>
            {g.screens.map((s) => (
              <Button
                key={s}
                asChild
                size="sm"
                // "designer" 走真实挂载点 /tpl/designer（F18），不是本原型内的屏切换——
                // 原型态 DesignerScreen 与真实设计器不是一回事，导航不能再指向原型（F318）。
                variant={s === "designer" ? "ghost" : s === screen ? "primary" : "ghost"}
                className="justify-start"
                data-testid="tpl-nav-item"
              >
                <a href={s === "designer" ? "/tpl/designer" : href({ screen: s })}>
                  {TPL_SCREEN_LABEL[s]}
                  <Badge tone="outline" className="ml-auto">{TPL_SCREEN_UC[s]}</Badge>
                </a>
              </Button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/* ── 乐观反馈行 ──────────────────────────────────────────────────────── */

export function TplToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="tpl-toast"
      className="absolute bottom-4 right-4 z-40 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <p className="text-12">{message}</p>
      <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="关闭提示" data-testid="tpl-toast-close">
        <X aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ── 预览控制条（屏 / 视角 / 七态）——生产不渲染 ────────────────────────── */

const ROLE_VIEW: ProjectRole[] = ["facilitator", "groupLead", "member", "observer"];

function PreviewControls({
  href, screen, uiState, qs,
}: {
  href: (o: Partial<{ as: string; state: string; screen: string }>) => string;
  screen: TplScreen;
  uiState: UiState;
  qs: { as?: string; org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "facilitator";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle bg-panel-alt px-3 py-2" data-testid="tpl-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {TPL_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="tpl-screen-switch">
            <a href={href({ screen: s })}>{TPL_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {ROLE_VIEW.map((r) => (
          <Button key={r} asChild size="xs" variant={currentAs === r ? "primary" : "ghost"} data-testid="tpl-role-switch">
            <a href={href({ as: r })}>{PROJECT_ROLE_LABEL[r]}</a>
          </Button>
        ))}
        <Badge tone="outline" className={cn("ml-1")}>预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <StatePreviewSwitcher current={uiState} />
    </div>
  );
}
