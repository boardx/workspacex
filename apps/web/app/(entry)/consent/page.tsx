import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { ConsentForm } from "@/components/entry/consent-form";
import { Badge } from "@/components/ui/badge";
import { CONSENT } from "@/lib/mock/entry";

/**
 * 受访者同意书（档案第九节 A）——外部受访者的同意与撤回。
 * 未登录 / 外部人员上下文，不套 AppShell。撤回的五步数据流是 D-13 前置进 phase-1 的那条链。
 */
export default function ConsentPage({
  searchParams,
}: {
  searchParams: { state?: string };
}) {
  const state = resolvePreviewState(searchParams.state);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <StatePreviewSwitcher current={state} />
        <p className="text-10 text-muted-foreground">
          当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm">
        <header className="flex flex-col gap-2" data-testid="consent-header">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-20 font-semibold tracking-tight">访谈同意书</h1>
            <Badge tone="neutral">外部受访者</Badge>
          </div>
          <p className="text-13 text-muted-foreground">
            {CONSENT.project} · 录音存于 {CONSENT.controller.org} 的服务器，
            <strong className="text-background-foreground">{CONSENT.retentionDays} 天后自动删除</strong>。
          </p>
        </header>

        <ConsentForm state={state} />
      </div>
    </div>
  );
}
