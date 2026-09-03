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

export interface TaskTemplate {
  readonly id: string;
  readonly label: string;
  readonly goal: string;
  /** 卡片左侧图标徽标里的单字标签（视觉分类用，不承载任何判据文案）。 */
  readonly badge: string;
  /** 徽标底色 + 前景色的语义 token 对（U5a 只允许语义色，见 `lint-design.sh`）。 */
  readonly badgeTone: "accent" | "warning-tint" | "ai-tint";
}

/**
 * 判据逐字点名的四类任务模板。`goal` 是模板被点击后真的填进输入框的文本——
 * 不是发送，是填进去（判据 TW-P0-1②反伪造条款：点了没反应/不影响输入框的按钮判 0）。
 */
export const TASK_WORKBENCH_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "chat-task-workbench-template-research",
    label: "调研市场并产出带来源的报告",
    goal: "帮我调研一下当前市场情况，产出一份带引用来源的调研报告。",
    badge: "研",
    badgeTone: "accent",
  },
  {
    id: "chat-task-workbench-template-reading",
    label: "阅读材料整理决策建议",
    goal: "帮我阅读我上传的材料，整理出可执行的决策建议。",
    badge: "读",
    badgeTone: "warning-tint",
  },
  {
    id: "chat-task-workbench-template-planning",
    label: "需求拆成计划并生成项目产物",
    goal: "帮我把这个需求拆成一份可执行的计划，并生成相应的项目产物。",
    badge: "拆",
    badgeTone: "accent",
  },
  {
    id: "chat-task-workbench-template-analysis",
    label: "分析数据发现异常并制图",
    goal: "帮我分析这份数据，找出其中的异常点，并生成图表。",
    badge: "析",
    badgeTone: "ai-tint",
  },
];

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
}: {
  onUseTemplate: (goal: string) => void;
  materialsCount: number;
  skillsCount: number;
}): JSX.Element {
  return (
    <div
      data-testid="copilotkit-v2-empty"
      className="flex h-full flex-col items-center justify-center gap-6 py-12 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <p
          className="max-w-md text-18 font-semibold tracking-tight text-card-foreground"
          data-testid="chat-task-workbench-goal-headline"
        >
          今天想完成什么？描述目标，Agent 会先提出计划，得到确认后再执行。
        </p>
        <p className="max-w-sm text-12 leading-relaxed text-muted-foreground">
          也可以拖入文件作为这轮对话的附件，或点麦克风语音输入。
        </p>
      </div>
      <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
        {TASK_WORKBENCH_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            data-testid={template.id}
            onClick={() => onUseTemplate(template.goal)}
            className="flex items-center gap-3 rounded-card border border-border-subtle bg-card px-3.5 py-3 text-left text-12 leading-relaxed text-card-foreground transition-colors duration-fast hover:border-primary/50 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          项目：个人对话
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-materials"
          data-source="live"
        >
          材料 {materialsCount}
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-skills"
          data-source="live"
        >
          技能 {skillsCount}
        </span>
        <span
          className="rounded-pill border border-border-subtle bg-card px-2.5 py-1 text-10 text-muted-foreground"
          data-testid="chat-task-workbench-context-chip-memory"
        >
          记忆范围：仅本对话
        </span>
      </div>
    </div>
  );
}
