"use client";
import * as React from "react";
import { Search, FileText, PlusSquare, MessageSquare, Radio, Sparkles } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { cn } from "@/lib/utils";
import type { Identity } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";
import {
  RS_SCREENS, RS_SCREEN_LABEL, RS_SCREEN_UC, RS_VIEWS,
  type RsScreen, type RsView,
} from "@/lib/mock/research-studio";
import { RsListScreen, RsPlanScreen, RsNewScreen, RsDetailScreen, RsLiveScreen } from "./rs-screens";
import { GuidedResearchFlow } from "./guided-research-flow";
import type { GuidedResearchStep } from "@/lib/mock/guided-research";

/**
 * 研究 Studio（M24 / 契约束 `research`）—— UI 先行原型编排。
 *
 * ⚠ 路由 **顶层 `/research`**（不是 `/studio/research`——那条被 UC-0.2 Context Pack 占用，
 *   Q-2 阻塞级未裁，见 README）。复用已确认的三栏骨架 AppShell + 七态 StateShell。
 * ⚠ 视角 = owner / collaborator 两档（U-1 已裁 = B），**不是**工作坊四种项目角色；
 *   观察者只读落在七态的 `denied`。真实权限在服务端，`?as=` / `?state=` / `?screen=` 仅预览。
 */
const SCREEN_ICON: Record<RsScreen, React.ComponentType<{ className?: string }>> = {
  list: Search,
  plan: FileText,
  new: PlusSquare,
  detail: MessageSquare,
  live: Radio,
};

export function ResearchStudioApp({
  identity, uiState, screen, view, sub, flow, qs,
}: {
  identity: Identity;
  uiState: UiState;
  screen: RsScreen;
  view: RsView;
  sub?: string;
  flow?: GuidedResearchStep;
  qs: { as?: string; flow?: string };
}) {
  const href = (o: Partial<{ as: string; state: string; screen: string; sub: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as && as !== "owner") p.set("as", as);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sc = o.screen ?? screen; if (sc && sc !== "list") p.set("screen", sc);
    const sb = "sub" in o ? o.sub : sub; if (sb) p.set("sub", sb);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AppShell identity={identity} previewRole={null} hideRoleSwitcher left={<LeftNav screen={screen} flow={flow} href={href} />}>
      <div className="flex h-full min-h-0 flex-col">
        {!flow && <PreviewControls screen={screen} view={view} uiState={uiState} href={href} />}
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="rs-main">
          {flow && <GuidedResearchFlow step={flow} />}
          {!flow && screen === "list" && <RsListScreen state={uiState} view={view} sub={sub} href={href} />}
          {!flow && screen === "plan" && <RsPlanScreen state={uiState} view={view} sub={sub} />}
          {!flow && screen === "new" && <RsNewScreen state={uiState} view={view} sub={sub} />}
          {!flow && screen === "detail" && <RsDetailScreen state={uiState} view={view} sub={sub} />}
          {!flow && screen === "live" && <RsLiveScreen state={uiState} view={view} sub={sub} />}
        </div>
      </div>
    </AppShell>
  );
}

/** 左栏：研究 Studio 的五块屏 IA（不是工作坊五段导航——这是 STUDIO 内的屏切换）。 */
function LeftNav({ screen, flow, href }: { screen: RsScreen; flow?: GuidedResearchStep; href: (o: Partial<{ screen: string; sub: string }>) => string }) {
  return (
    <nav className="flex flex-col gap-1 p-3" data-testid="rs-left-nav">
      <span className="px-1 pb-1 text-10 uppercase tracking-wide text-muted-foreground">研究 Studio</span>
      <a
        href="?flow=home"
        data-testid="rs-nav-guided-research"
        data-active={Boolean(flow)}
        className={cn(
          "mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-colors",
          flow ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Sparkles className="h-4 w-4" /><span className="flex-1">引导式研究</span><Badge tone="ai">新</Badge>
      </a>
      {RS_SCREENS.map((s) => {
        const Icon = SCREEN_ICON[s];
        const active = s === screen;
        return (
          <a
            key={s}
            href={flow ? `?screen=${s}` : href({ screen: s, sub: undefined })}
            data-testid={`rs-nav-${s}`}
            data-active={active}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{RS_SCREEN_LABEL[s]}</span>
            <Badge tone="outline">{RS_SCREEN_UC[s]}</Badge>
          </a>
        );
      })}
    </nav>
  );
}

/** 预览控制条：视角切换器（owner/collaborator）+ 七态切换器。生产构建不渲染。 */
function PreviewControls({
  screen, view, uiState, href,
}: {
  screen: RsScreen;
  view: RsView;
  uiState: UiState;
  href: (o: Partial<{ as: string; state: string; screen: string }>) => string;
}) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-panel px-4 py-2" data-testid="rs-preview-controls">
      <div className="flex items-center gap-1" data-testid="rs-view-switcher">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {RS_VIEWS.map((v) => (
          <Button key={v.id} asChild size="xs" variant={v.id === view ? "primary" : "ghost"} data-testid={`rs-view-${v.id}`}>
            <a href={href({ as: v.id })} title={v.note}>{v.label}</a>
          </Button>
        ))}
      </div>
      <div className="hidden md:block"><StatePreviewSwitcher current={uiState} /></div>
      <span className="ml-auto text-10 text-muted-foreground">/research · {RS_SCREEN_UC[screen]}</span>
    </div>
  );
}
