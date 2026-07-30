import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { ChatLeftPanel } from "@/components/chat/chat-left-panel";
import { PresetDispatch } from "@/components/chat/preset-dispatch";

/**
 * UC-8.4 预设对话与技能屏（顶层 `/chat/preset`，并行安全）—— v2 重画。
 *
 * ⚠ v1 误报「预设原型 0 命中、每个控件都是新设计」。原型实为完整一屏（工作坊详情→对话子页）：
 *   页头「预设对话与技能」+ 四列表（预设对话|内置技能|下发对象|使用）+ 新建预设弹层。
 * 权限模型原型已答（不是待裁决）：引导师下发给组长/组员；被下发者能改；上架供取用可拒。
 *
 * 视角（预览手段，非权限实现）：引导师视角 = 下发端；组员/观察者视角 = 「点开即用」消费端。
 * 七态 `?state=`；视角 `?as=`。
 */
export default function ChatPresetPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  // 组员 / 观察者看消费端（点开即用）；引导师 / 组长看下发端。写操作仅引导师。
  const consumerView = previewRole === "member" || previewRole === "observer";
  const readOnly = previewRole !== "facilitator";

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<ChatLeftPanel />}>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-border-subtle bg-panel px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-10 text-muted-foreground">
              当前态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
              {consumerView && " · 消费端（点开即用）"}
            </span>
            <StatePreviewSwitcher current={state} />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <PresetDispatch state={state} readOnly={readOnly} consumerView={consumerView} />
        </div>
      </div>
    </AppShell>
  );
}
