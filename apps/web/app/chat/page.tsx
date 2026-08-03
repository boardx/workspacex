import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";
import { ChatLeftPanel } from "@/components/chat/chat-left-panel";
import { ChatRightPanel } from "@/components/chat/chat-right-panel";
import { ChatMain } from "@/components/chat/chat-main";

/**
 * 对话主屏（08-chat / 04-agent）—— 产品信息密度最高的一屏。
 *
 * 承载：
 *  · 左栏：AI 团队面板（6 agent 三态，UC-4.2）+ 线程列表（今天/本周/周三，UC-8.1）
 *  · 中栏：线程头部 + 消息流四类卡（含**批准卡**信任核心，UC-8.2 R3）+ 改派条 + 输入区
 *  · 右栏：五标签 转录/执行/洞察/产物/材料（UC-8.2 R3 四）
 *  · 七态：`?state=` 走 default/loading/empty/invalid/dep-failed/denied/success（走 StateShell）
 *  · 视角：`?as=` 四视角预览，观察者只读（UC-8.5）——预览手段，非权限实现
 *
 * ⚠ 服务端组件：只读 searchParams、调纯函数；一切事件处理器都在 `"use client"` 子组件里。
 */
export default function ChatPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const readOnly = previewRole === "observer";

  return (
    <AppShell
      previewRole={previewRole}
      left={<ChatLeftPanel />}
      right={<ChatRightPanel state={state} />}
    >
      <div className="flex h-full flex-col">
        {/* 预览状态切换器：生产构建不渲染（UC-0.4 R9 / R12 V8）*/}
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
          <ChatMain state={state} readOnly={readOnly} />
        </div>
      </div>
    </AppShell>
  );
}
