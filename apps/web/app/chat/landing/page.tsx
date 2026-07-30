import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { ChatLeftPanel } from "@/components/chat/chat-left-panel";
import { ChatRightPanel } from "@/components/chat/chat-right-panel";
import { LandingPanel } from "@/components/chat/landing-panel";

/**
 * UC-8.3 对话产出落地屏（顶层 `/chat/landing`，并行安全）。
 *
 * 三模式绑定 / 出处回链 / 未挂来源标灰 / 引用资格门控——机制底座在 `00-core/uc-0-1`，本屏只接线。
 * 七态 `?state=`；视角 `?as=`（观察者只读，服务端不下发的界面等价，预览手段非权限实现）。
 */
export default function ChatLandingPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const readOnly = previewRole === "observer";

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<ChatLeftPanel />}
      right={<ChatRightPanel state={state} />}
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-border-subtle bg-panel px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-10 text-muted-foreground">
              当前态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
              {readOnly && " · 观察者只读投影"}
            </span>
            <StatePreviewSwitcher current={state} />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <LandingPanel state={state} readOnly={readOnly} />
        </div>
      </div>
    </AppShell>
  );
}
