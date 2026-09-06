/**
 * /chat run 进度卡（`copilotkit-v2-running-indicator`）—— 纯展示组件。
 *
 * issue #2837（PR #2839 review）—— 这块 JSX 原本内联在 `copilotkit-v2-panel-body.tsx`
 * （已超 2000 行的文件，AGENTS.md 文件规模约束），且截图 harness
 * `.run-progress-butterfly-animation/harness.tsx` 为了出证据把同一套 className 抄了第二份——
 * 同一事实声明在两处，卡片再改一次两边就会漂。现在抽成独立文件：面板 body 与截图
 * harness 都渲染**这一个**组件，截图就是真实 UI，不再是复刻。
 *
 * ## 形态（issue #2837，2026-09-06 devapp 人类实测「太小、动效呆板」）
 *
 * 「左：蝴蝶 28px 竖向居中（`RunProgressButterfly`，默认 `fly` 动效）；右：两到三行文案」——
 * 阶段行（准备 → 执行 → 回复，`text-12`）、思考/计时行（`text-13`）、可选的计划步骤行。
 * 字号只取 `lib/font-scale.ts` 在册档位。
 *
 * ## 不变量
 *
 * `copilotkit-v2-running-indicator`（容器）与 `copilotkit-v2-thinking*`（内部各段）这两组
 * testid 被 `chat-task-workbench-fixture.ts` 的 `sendAndSettle`、
 * `chat-task-workbench-inspector.spec.ts`、`copilotkit-v2-message-actions.spec.ts` 当成
 * "这一轮跑完了没有"的信号在用：在跑=在，跑完=不在。改名会把三处既有断言变成
 * "元素不存在 ⇒ 立即通过"的静默假绿——**一个不许动**。
 *
 * 什么时候渲染（`agent.isRunning || runRestore.isRestoring`）由调用方决定，本组件只管长相；
 * `stage` 为 `null`（未开始、或 run 恢复核实窗口——那段没有真实事件支撑）时不渲染阶段行，
 * 不编一个默认阶段；没有计划时不渲染步骤行——编一句"正在处理第 1 步"就是假进度。
 */
"use client";
import * as React from "react";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { LONG_RUN_HINT, type RunStage } from "@/lib/copilotkit-v2-run-progress";
import {
  RunProgressButterfly,
  type RunProgressButterflyMotion,
} from "@/components/chat/run-progress-butterfly";

/** PROP-CHAT-UIUX-ITER-002 V2 —— 三桶宏观阶段的显示顺序与文案，唯一事实源。 */
export const RUN_STAGE_ORDER: ReadonlyArray<{ key: RunStage; label: string }> = [
  { key: "preparing", label: "准备" },
  { key: "acting", label: "执行" },
  { key: "replying", label: "回复" },
];

export interface RunProgressCardProps {
  /** 三桶宏观阶段；`null` 不渲染阶段行（见文件头）。 */
  stage: RunStage | null;
  /** 思考行文案（调用方已把 run 恢复窗口 / 兜底文案折算好）。 */
  phaseLabel: string;
  elapsedSeconds: number | null;
  isLongRun: boolean;
  /** 工具阶段里真正回答"它在干嘛"的那一行；`null` 不渲染。 */
  planStep: { readonly index: number; readonly total: number; readonly content: string } | null;
  /** 仅供截图 harness 比对候选动效；生产默认走组件默认值。 */
  motion?: RunProgressButterflyMotion;
  className?: string;
}

export function RunProgressCard({
  stage,
  phaseLabel,
  elapsedSeconds,
  isLongRun,
  planStep,
  motion,
  className,
}: RunProgressCardProps): JSX.Element {
  return (
    <div
      data-testid="copilotkit-v2-running-indicator"
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-fit max-w-full items-center gap-3 rounded-xl border border-border-subtle bg-muted/60 px-4 py-3",
        className,
      )}
    >
      <RunProgressButterfly motion={motion} />
      <div className="flex min-w-0 flex-col gap-1">
        {stage !== null ? (
          <span
            className="flex items-center gap-1.5 text-12 text-muted-foreground"
            data-testid="copilotkit-v2-thinking-stage"
            data-stage={stage}
          >
            {RUN_STAGE_ORDER.map(({ key, label }, i) => (
              <React.Fragment key={key}>
                {i > 0 ? <span aria-hidden>→</span> : null}
                <span className={cn(key === stage && "font-medium text-card-foreground")}>{label}</span>
              </React.Fragment>
            ))}
          </span>
        ) : null}
        <span
          className="flex flex-wrap items-center gap-1.5 text-13 text-muted-foreground"
          data-testid="copilotkit-v2-thinking"
        >
          <span data-testid="copilotkit-v2-thinking-phase">{phaseLabel}</span>
          {elapsedSeconds !== null ? (
            <span data-testid="copilotkit-v2-thinking-elapsed">· 已用 {elapsedSeconds} 秒</span>
          ) : null}
          {isLongRun ? <span data-testid="copilotkit-v2-thinking-longrun-hint">· {LONG_RUN_HINT}</span> : null}
        </span>
        {planStep !== null ? (
          <span
            className="flex min-w-0 items-center gap-1.5 text-12 text-card-foreground"
            data-testid="copilotkit-v2-thinking-plan-step"
          >
            <ListChecks aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 truncate">
              第 {planStep.index}/{planStep.total} 步 · {planStep.content}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
