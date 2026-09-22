"use client";
import * as React from "react";
import { Check, X } from "lucide-react";
import type { TraceEntry } from "@/lib/chat-workbench/run-trace";
import { toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";

/**
 * 2026-09-22 —— 长任务在**产出正文之前**的「最近几步」预览。
 *
 * ## 取证起点（人类实测截图）
 *
 * 一次深度研究：折叠行写着「正在推进任务 · 已完成 17 步 · 有失败步骤 · 历时 05:20 ·
 * 工具 17 次 · 技能活动 25 项」，而**整屏除了这一行什么都没有**——正文一个字都还没产生，
 * 已经发生的 17 步全在折叠区（`hidden`）里。用户能看到的只有一行字和一只蝴蝶；那一行还说
 * 「有失败步骤」，却没有任何**不展开就能到达**的地方看那是哪一步。
 *
 * 这正是 #3320 自己诊断出的主机制 (b)「渲染了但默认折叠且无活性信号」。当时的修法是折叠行里
 * 那条活性文案（`RunTraceLiveStrip`）——它在**有正文**的普通对话里够用，因为屏幕上还有别的
 * 东西可读；但在一次五分钟零正文的长任务里，一行字撑不起一屏，而且它只说得出**最后一条**。
 *
 * ## 为什么挂在折叠区外面，而不是把默认值改成展开
 *
 * 改默认值是我的第一版，`fullstack-smoke` 把它拦下来了：
 * `chat-trace-failure-forward-motion-geometry.spec.ts` 的前提逐字写着「整块轨迹此刻确实是
 * **折叠**的……若哪天默认改成展开，本条门的前提就变了，必须在这里红出来」——它按设计红了。
 * 全仓还有至少五条 e2e 断言 `aria-expanded === "false"`。那个默认值是被反复确认过的产品选择，
 * 而「折叠」本身也是用户可能显式设过的状态，不该被自动翻掉。
 *
 * 所以走这个组件本来就有的先例：**把要让人看见的东西挂在折叠区之外**（活性条与后台任务面板
 * 都是这么做的，见 `RunTraceLiveStrip` 头注与 #3100 D6）。展开与否一个字没改，用户点开看到的
 * 仍是完整轨迹；这里只是在屏幕空着的时候，把最近几步摆到屏幕上。
 *
 * ## 判据与边界
 *   · 还活着（`active`，取自面板自己的执行账本 status，不新增第二处推导）；
 *   · 这一轮**一条正文事件都没有**（`text_delta` 或 `final_message`）——正文一出现，
 *     屏幕上就有东西可读了，这块预览随即消失，不跟正文抢位置；
 *   · 至少 2 个动作——只有 1 个时折叠行那一句已经把它说完了，再摆一遍是重复。
 */
export const RUN_TRACE_LIVE_PREVIEW_LIMIT = 3;

export function RunTraceLivePreview({ entries, active, hasAssistantText }: {
  readonly entries: readonly TraceEntry[];
  readonly active: boolean;
  readonly hasAssistantText: boolean;
}): React.JSX.Element | null {
  if (!active || hasAssistantText) return null;
  // 只看真正发生过的动作：进行中与已收尾。`progress`（正文增量）不在这里露面。
  const actions = entries.filter((entry) => entry.kind === "tool" || entry.kind === "skill");
  if (actions.length < 2) return null;
  const recent = actions.slice(-RUN_TRACE_LIVE_PREVIEW_LIMIT);
  return (
    <ul
      data-testid="run-trace-live-preview"
      data-count={String(recent.length)}
      data-total={String(actions.length)}
      className="ml-3 space-y-1 border-l border-border-subtle pl-4 text-12 text-muted-foreground"
    >
      {recent.map((entry) => (
        <li
          key={entry.id}
          data-testid="run-trace-live-preview-row"
          data-status={entry.status}
          className="flex min-w-0 items-center gap-2"
        >
          {entry.status === "failed"
            ? <X aria-label="这一步失败了" className="h-3 w-3 shrink-0 text-destructive" />
            : entry.status === "running"
              ? <span aria-label="进行中" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
              : <Check aria-label="已完成" className="h-3 w-3 shrink-0" />}
          <span className="min-w-0 truncate">{toolObject(entry.text, entry.args) ?? toolLabel(entry.text)}</span>
        </li>
      ))}
      {actions.length > recent.length && (
        <li data-testid="run-trace-live-preview-more" className="text-11 opacity-70">
          {/* 说清楚上面只是最近几步，别让用户以为一共就做了这三件 */}
          展开可看全部 {String(actions.length)} 个动作
        </li>
      )}
    </ul>
  );
}
