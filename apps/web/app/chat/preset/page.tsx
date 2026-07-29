import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { ChatLeftPanel } from "@/components/chat/chat-left-panel";
import { PresetDispatch } from "@/components/chat/preset-dispatch";

/**
 * UC-8.4 预设对话下发屏（顶层 `/chat/preset`，并行安全）。
 *
 * ⚠ 整屏为补画原型（原型 0 命中）。**权限模型未定**：谁能给谁下发、被下发者能不能改/拒——
 *   UC 未写死，界面把这三个问题做成显式待裁决卡，不替 UC 表态。
 * 无右栏（预设编辑不需要对话上下文栏）。七态 `?state=`；视角 `?as=`。
 */
export default function ChatPresetPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const readOnly = previewRole === "observer";

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<ChatLeftPanel />}>
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
          <PresetDispatch state={state} readOnly={readOnly} />
        </div>
      </div>
    </AppShell>
  );
}
