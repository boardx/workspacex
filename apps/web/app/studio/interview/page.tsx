import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { InterviewOutline } from "@/components/interview/interview-outline";
import { InterviewStage } from "@/components/interview/interview-stage";
import { InterviewCopilot } from "@/components/interview/interview-copilot";
import { InterviewViewSwitcher } from "@/components/interview/interview-view-switcher";
import { resolveInterviewView } from "@/lib/mock/interview";

/**
 * Studio · 访谈 —— 现场记录与 AI 副驾驶（UC-6.4）为主屏，聚合：
 *   实时转录 / 说话人指派 / 引述打点（UC-5.1~5.3）、受访者授权联动（UC-6.3）、
 *   洞察回流（UC-6.5）、保留期（UC-5.4）、撤回下游影响（D-13）。
 *
 * 七态经 `?state=` 走完；角色视角经 `?view=` 预览（预览手段，非权限实现）。
 * 交互全部下沉到 `"use client"` 子组件；本页只解析 query 并组装三栏骨架。
 */
export default function InterviewPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; view?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const view = resolveInterviewView(searchParams.view);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const isInterviewee = view === "interviewee";

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={isInterviewee ? undefined : <InterviewOutline />}
      right={isInterviewee ? undefined : <InterviewCopilot view={view} />}
    >
      <div className="flex flex-col gap-3 p-4 pb-0">
        <div className="flex flex-col gap-1">
          <StatePreviewSwitcher current={state} />
          <p className="text-10 text-muted-foreground">
            当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
          </p>
        </div>
        <InterviewViewSwitcher current={view} state={state} />
      </div>
      <InterviewStage state={state} view={view} />
    </AppShell>
  );
}
