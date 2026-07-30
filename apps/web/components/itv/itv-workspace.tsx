import { Eye } from "lucide-react";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { ItvViewSwitcher } from "./itv-view-switcher";
import { TemplateLibrary } from "./template-library";
import { TemplateEditor } from "./template-editor";
import { NewInterviewWizard } from "./new-interview-wizard";
import { InterviewList } from "./interview-list";
import { ResearchDesign } from "./research-design";
import { LiveRecord } from "./live-record";
import { VirtualPersona } from "./virtual-persona";
import { InsightReport } from "./insight-report";
import {
  ITV_SCREENS,
  isReadOnlyItvView,
  type ItvScreen,
  type ItvView,
  type ScopeId,
} from "@/lib/mock/itv";
import type { UiState } from "@/lib/ui-state";

/**
 * 访谈能力域 v2 的中栏工作区 —— 顶部预览工具条（视角 + 七态）+ 只读横幅 + 屏分发。
 * 视角切换是预览手段，不是权限实现（真实权限在服务端）。
 */
export function ItvWorkspace({
  screen,
  state,
  view,
  scope,
  step,
}: {
  screen: ItvScreen;
  state: UiState;
  view: ItvView;
  scope: ScopeId;
  step: 1 | 2 | 3;
}) {
  const meta = ITV_SCREENS.find((s) => s.id === screen)!;
  const readOnly = isReadOnlyItvView(view);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-5 py-2.5">
        <div className="flex flex-col">
          <span className="text-11 text-muted-foreground">
            {meta.step} · {meta.uc} · {meta.note}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ItvViewSwitcher current={view} state={state} screen={screen} scope={scope} />
          <StatePreviewSwitcher current={state} />
        </div>
      </div>

      {readOnly && (
        <div
          data-testid="itv-readonly-banner"
          className="flex items-center gap-2 border-b border-border bg-muted px-5 py-1.5 text-11 text-muted-foreground"
        >
          <Eye aria-hidden className="h-3.5 w-3.5" />
          当前为{view === "observer" ? "观察者" : "受访者"}视角（只读预览）：写操作已禁用，仅演示可见范围。真实权限在服务端强制。
        </div>
      )}

      {screen === "library" && <TemplateLibrary state={state} view={view} />}
      {screen === "template-editor" && <TemplateEditor state={state} view={view} />}
      {screen === "new" && <NewInterviewWizard state={state} view={view} step={step} />}
      {screen === "interviews" && <InterviewList state={state} view={view} scope={scope} />}
      {screen === "design" && <ResearchDesign state={state} view={view} />}
      {screen === "record" && <LiveRecord state={state} view={view} />}
      {screen === "virtual" && <VirtualPersona state={state} view={view} />}
      {screen === "insight" && <InsightReport state={state} view={view} />}
    </div>
  );
}
