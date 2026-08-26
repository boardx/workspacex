"use client";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES } from "@/lib/identity";
import { UI_STATES, UI_STATE_LABEL, type UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { CANVAS_SCREENS, type CanvasScreen } from "@/lib/canvas-screens";
import { AdminNav } from "@/components/admin/admin-nav";
import { TemplateAdmin } from "./template-admin";
import { TemplateEditor } from "./template-editor";
import { SegmentBinding } from "./segment-binding";
import { AiDraftPanel } from "./ai-draft-panel";
import { KnowledgeBackflow } from "./knowledge-backflow";
import { CanvasMain } from "./canvas-main";
import { CanvasLeftPanel } from "./canvas-left-panel";
import { CanvasRightPanel } from "./canvas-right-panel";

/**
 * canvas 能力域 · UI 先行原型的屏聚合（顶层路由 /canvas，并行安全）。
 *
 * 一个页面切五屏（? screen=）× 四视角（? as=）× 七态（? state=），
 * 顶部预览控制条统一切换——沿用 files 屏的做法。三栏骨架、语义导航、AI 四种在场
 * 都用既有 AppShell / 既有画布组件，不另起一套。
 *
 * ⚠ 视角切换是**预览手段，不是权限实现**：真实权限在服务端（NestJS Guard + RLS）。
 *
 * ## `template-admin` 屏的左栏：D-43 已被人类推翻（2026-08-17）
 *
 * D-43（2026-08-15）当时把这一屏从「后台通用外壳 + `AdminNav` 侧栏」摘出来做成
 * 独立整页，人类原话「画布模板……右边的列表，应该和打开模板和编辑器的界面整合，
 * 合并成一个」。2026-08-17 人类看到部署后的真实截图后明确要求把左侧后台菜单
 * 加回来——这条裁决因此被**推翻**，不是当年的判断有误，是产品要求变了。
 * `AdminNav` 只挂在 `template-admin` 屏（后台「画布模板」菜单项唯一指向这里），
 * 其余五屏不挂，理由与当年 `isEditor` 判断同型：不同屏各自的导航需求不同，
 * 不该共用同一份「有没有左栏」的开关。
 */
export function CanvasHub({
  previewRole, uiState, screen, initialConflict,
  tplFilter, tplQuery,
}: {
  previewRole: ProjectRole | null;
  uiState: UiState;
  screen: CanvasScreen;
  initialConflict: boolean;
  /** #9（2026-08-22 可用性改进轮）：`template-admin` 屏筛选/视图/搜索词的 URL 初值。 */
  tplFilter?: string;
  tplQuery?: string;
}) {
  // 编辑器屏用画布三区左右栏；模板库屏用后台通用侧栏；其余屏是全宽单栏（各自内部布局）
  const isEditor = screen === "editor";
  const isTemplateAdmin = screen === "template-admin";

  return (
    <AppShell
      previewRole={previewRole}
      left={
        isEditor ? <CanvasLeftPanel />
        : isTemplateAdmin ? <AdminNav active="canvasadmin" />
        : undefined
      }
      right={isEditor ? <CanvasRightPanel /> : undefined}
    >
      <div className="flex h-full flex-col">
        <PreviewControlBar screen={screen} state={uiState} role={previewRole} />
        <div className="min-h-0 flex-1">
          {screen === "template-admin" && (
            <TemplateAdmin previewRole={previewRole} initialFilter={tplFilter} initialQuery={tplQuery} />
          )}
          {screen === "template-editor" && <TemplateEditor state={uiState} previewRole={previewRole} />}
          {screen === "segment-binding" && <SegmentBinding state={uiState} previewRole={previewRole} />}
          {screen === "ai-draft" && <AiDraftPanel state={uiState} previewRole={previewRole} />}
          {screen === "backflow" && <KnowledgeBackflow state={uiState} previewRole={previewRole} />}
          {isEditor && <CanvasMain state={uiState} previewRole={previewRole} initialConflict={initialConflict} />}
        </div>
      </div>
    </AppShell>
  );
}

/** 预览控制条（仅 dev；生产 NODE_ENV=production 不渲染，与其它屏一致）*/
function PreviewControlBar({ screen, state, role }: { screen: CanvasScreen; state: UiState; role: ProjectRole | null }) {
  if (process.env.NODE_ENV === "production") return null;
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ screen, state, as: role ?? "facilitator", ...over });
    return `?${p.toString()}`;
  };
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle bg-panel px-3 py-1.5" data-testid="canvas-preview-bar">
      <Row label="屏">
        {CANVAS_SCREENS.map((s) => (
          <Button key={s.id} asChild size="xs" variant={s.id === screen ? "primary" : "ghost"} data-testid={`canvas-screen-${s.id}`}>
            <a href={qs({ screen: s.id })} title={s.uc}>{s.label}</a>
          </Button>
        ))}
      </Row>
      <Row label="视角">
        {PROJECT_ROLES.map((r) => (
          <Button key={r} asChild size="xs" variant={r === role ? "secondary" : "ghost"} data-testid={`canvas-role-${r}`}>
            <a href={qs({ as: r })}>{PROJECT_ROLE_LABEL[r]}</a>
          </Button>
        ))}
        <span className="ml-1 text-9 text-muted-foreground">视角=预览，真实权限在服务端</span>
      </Row>
      <Row label="七态">
        {UI_STATES.map((s) => (
          <Button key={s} asChild size="xs" variant={s === state ? "primary" : "ghost"} data-testid={`state-switch-${s}`}>
            <a href={qs({ state: s })}>{UI_STATE_LABEL[s]}</a>
          </Button>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-8 shrink-0 text-9 uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
