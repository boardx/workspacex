import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { ResearchRuns } from "@/components/research/research-runs";
import { ContextPack } from "@/components/research/context-pack";
import { ClaimMatrix } from "@/components/research/claim-matrix";
import { ResearchViewSwitcher } from "@/components/research/research-view-switcher";
import { resolveResearchView } from "@/lib/mock/research";

/**
 * Studio · 研究 —— Context Pack（UC-0.2）最直接的消费面：一次研究读了什么、丢了什么。
 * 丢弃清单可查、带原因、可定位。洞察矩阵每条挂读入证据（UC-6.5 AC1）。
 * 七态经 `?state=`，角色视角经 `?view=`。交互下沉客户端组件。
 */
export default function ResearchPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; view?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const view = resolveResearchView(searchParams.view);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<ResearchRuns />}
      right={<ClaimMatrix />}
    >
      <div className="flex flex-col gap-3 p-4 pb-0">
        <div className="flex flex-col gap-1">
          <StatePreviewSwitcher current={state} />
          <p className="text-10 text-muted-foreground">
            当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
          </p>
        </div>
        <ResearchViewSwitcher current={view} state={state} />
      </div>
      <ContextPack state={state} view={view} />
    </AppShell>
  );
}
