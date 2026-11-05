"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * issue #2130（TW-P0-1，回指 #2068）—— 新对话「任务型空状态」：目标引导语 + 4 个
 * 真实任务模板 + 上下文标签行。取代此前的会话隐喻空状态（`copilotkit-v2-empty`
 * 两行静态文字「开始新的对话」）。
 *
 * 判据见 `.harness/instructions/chat-task-workbench-acceptance.md` TW-P0-1 一节，
 * 唯一事实源在那里，这里只放实现注释。
 *
 * ## 上下文标签数字的来源（反伪造条款：不得写死）
 *
 * - 「材料 N」—— `materialsCount` 来自调用方 `copilotkit-v2-panel.tsx` 里已经存在的
 *   `attach.uploadedIds.length`（composer 里真实上传成功、尚未随消息发出的附件数）。
 *   新对话还没有任何线程时这个数天然是 0——那也是**真实值**，不是编的占位。
 * - 「技能 N」—— `skillsCount` 来自调用方传入的挂载记录真实计数；空状态阶段还没有
 *   持久化线程（`chatThreadId === null`），没有线程就没有真实的挂载对象，如实为 0，
 *   不伪造一个非零数字。
 * - 「项目」「记忆范围」—— 这两项不要求 `data-source="live"`（判据原文只对材料/技能
 *   两项提出这条要求），但内容仍然是真实事实而非编造：本轨道（`/chat` 裸路径）管理的
 *   全部是**个人线程**（`createPersonalThread`，`projectId` 恒 `null`，见
 *   `copilotkit-v2-shell.tsx` 头注），因此「项目」如实显示「个人对话」；「记忆范围」
 *   全仓当前没有跨线程/长期记忆机制（已 grep 全仓确认零命中），如实显示「仅本对话」。
 */

export type { TaskTemplate } from "@/lib/chat-task-templates";
export { TASK_WORKBENCH_TEMPLATES } from "@/lib/chat-task-templates";
import type { TaskTemplate } from "@/lib/chat-task-templates";
import { localizedTaskTemplates } from "@/lib/i18n/chat-task-copy";
import { useI18n } from "@/lib/i18n/provider";

/** 徽标底色/前景色 → 类名，避免四处重复拼字符串（U5a：只用语义 token）。 */
const BADGE_TONE_CLASSES: Record<TaskTemplate["badgeTone"], string> = {
  accent: "bg-accent text-accent-foreground",
  "warning-tint": "bg-warning-tint text-warning-tint-foreground",
  "ai-tint": "bg-ai-tint text-ai-tint-foreground",
};

export function TaskWorkbenchEmptyState({
  onUseTemplate,
  materialsCount,
  skillsCount,
  briefing,
  inProject = false,
}: {
  onUseTemplate: (goal: string) => void;
  materialsCount: number;
  skillsCount: number;
  /**
   * issue #4362：个人对话的开场简报（「接着上次」），摆在引导语与任务模板之间。只由调用方在个人对话里传入；
   * 简报自己决定有没有内容（没有就不渲染），这里只给位置，不影响模板与输入框。
   */
  briefing?: React.ReactNode;
  /** 项目内对话：「项目」标签写「本项目对话」，不能再说「个人对话」。 */
  inProject?: boolean;
}): JSX.Element {
  const { locale, t } = useI18n();
  return (
    <div
      data-testid="copilotkit-v2-empty"
      className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-4 text-center sm:px-6"
    >
      {/*
        #6068：仅调整注释，验证小范围回归的真实队列链路。
        两级视觉层次（大标题 + 小字说明），对齐参照图。`data-testid` 挂在外层
        wrapper 上而不是单个 <p>——TW-P0-1① 的判据（`chat-task-workbench-empty-state.spec.ts`）
        只断言这个锚点的 innerText 同时包含「计划」「确认」两个词，不要求它们落在
        同一个文本节点，拆分展示不影响这条判据。文案本身一字未改。
      */}
      <div className="flex flex-col items-center gap-2" data-testid="chat-task-workbench-goal-headline">
        <p className="max-w-xl text-24 sm:text-30 font-semibold tracking-tight text-card-foreground">{t("chatEntry.headline")}</p>
        <p className="max-w-lg text-14 leading-relaxed text-muted-foreground">
          {t("chatEntry.hint")}
        </p>
      </div>
      {briefing}
      <div className="grid w-full max-w-xl grid-cols-2 gap-x-3">
        {localizedTaskTemplates(locale).map((template) => (
          <button
            key={template.id}
            type="button"
            data-testid={template.id}
            onClick={() => onUseTemplate(template.goal)}
            className="flex items-center gap-2 border-b border-border-subtle bg-card px-2 py-2 text-left text-13 leading-relaxed text-card-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-12 font-semibold",
                BADGE_TONE_CLASSES[template.badgeTone],
              )}
            >
              {template.badge}
            </span>
            <span>{template.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-project"
        >
          {t(inProject ? "chatEntry.project" : "chatEntry.personal")}
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-materials"
          data-source="live"
        >
          {t("chatEntry.materials", { count: materialsCount })}
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-skills"
          data-source="live"
        >
          {t("chatEntry.skills", { count: skillsCount })}
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-memory"
        >
          {t("chatEntry.memory")}
        </span>
      </div>
    </div>
  );
}
