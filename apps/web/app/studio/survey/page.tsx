import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { SurveyList } from "@/components/survey/survey-list";
import { SurveyWorkspace } from "@/components/survey/survey-workspace";
import { SurveyEvidence } from "@/components/survey/survey-evidence";
import { SurveyViewSwitcher } from "@/components/survey/survey-view-switcher";
import { resolveSurveyView } from "@/lib/mock/survey";

/**
 * Studio · 问卷（UC-12.1 设计 / 12.2 发放回收 / 12.3 交叉分析 / 12.4 现场投票）。
 * 主区四视图用 Tabs；七态经 `?state=`，角色视角经 `?view=`。交互下沉客户端组件。
 */
export default function SurveyPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; view?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const view = resolveSurveyView(searchParams.view);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<SurveyList />}
      right={<SurveyEvidence />}
    >
      <div className="flex flex-col gap-3 p-4 pb-0">
        <div className="flex flex-col gap-1">
          <StatePreviewSwitcher current={state} />
          <p className="text-10 text-muted-foreground">
            当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
          </p>
        </div>
        <SurveyViewSwitcher current={view} state={state} />
      </div>
      <SurveyWorkspace state={state} view={view} />
    </AppShell>
  );
}
