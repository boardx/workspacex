"use client";

/**
 * 阶段条 —— 界面回答「**现在走到哪一步、在等谁做什么**」。
 *
 * ## 为什么这个组件值得单独存在
 *
 * 在它之前，team3 只是一个聊天框。聊天框有一个结构性缺陷：**它没有"现在"**。
 * 用户离开三天再回来，要靠往上翻消息自己拼出"上次聊到哪了、该我做什么了"。
 * 活动图描述的是一条有阶段、有等待、有回退的流程——这些在一串气泡里是看不见的。
 *
 * 所以阶段条不是装饰。它是评分卡 U2 的全部内容：
 * 用户瞥一眼就知道自己在哪、下一步归谁。
 *
 * ## 三段分组不是 UI 偏好
 *
 * 需求文档把流程分成三步（采集与确认 / 生成与确认 / 验证与复盘），三道硬门正好是
 * 三步的边界。分组直接来自那个结构，所以这里按硬门切——不是"看着分三段好看"。
 */
import * as React from "react";
import { Check, Clock, UserCheck } from "lucide-react";
import { researchWorkflow as C } from "@repo/contracts";
import { cn } from "@/lib/utils";

/** 阶段 → 它属于三步中的哪一步。边界就是三道硬门。 */
const STEP_OF: Readonly<Record<C.ResearchPhaseName, 1 | 2 | 3>> = {
  empty: 1, collecting: 1, materials_review: 1, materials_approved: 1,
  fields_pending: 2, logic_pending: 2, generating: 2, graph_review: 2, graph_published: 2,
  awaiting_verification: 3, backfilling: 3, plan_review: 3,
};

const STEP_LABELS = ["材料采集与确认", "图谱生成与确认", "验证回填与复盘"] as const;

/** 当前阶段在整条流程里的序号——用来判断某一步是"已过""正在""还没到"。 */
function phaseIndex(phase: C.ResearchPhaseName): number {
  return C.RESEARCH_PHASES.indexOf(phase);
}

export interface ResearchPhaseBarProps {
  phase: C.ResearchPhaseName;
  /** 血缘里的已发布版本号——>0 时说明这条研判已经产出过正式结论。 */
  publishedGraphVersion: number;
  verifyDueAt: string | null;
}

export function ResearchPhaseBar({
  phase,
  publishedGraphVersion,
  verifyDueAt,
}: ResearchPhaseBarProps): JSX.Element {
  const currentStep = STEP_OF[phase];
  // ⚠ 门表**不在这里复述**：`C.pendingGate` 与后端状态机读的是契约里同一份
  //   `GATE_TRANSITIONS`。前端抄一份门表正是本项目已栽五次的漂移形状——
  //   后端加一道门而前端阶段条不知道，用户就会卡在一个"没人在等"的等待里。
  const waitingGate = C.pendingGate(phase);

  return (
    <div
      data-testid="research-phase-bar"
      data-phase={phase}
      className="border-b border-border bg-muted/30 px-5 py-3 md:px-8"
    >
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-2">
        {/* 三步 */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {STEP_LABELS.map((label, i) => {
            const step = (i + 1) as 1 | 2 | 3;
            const done = step < currentStep;
            const active = step === currentStep;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  data-testid={`research-step-${step}`}
                  data-state={done ? "done" : active ? "active" : "todo"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-11 font-medium",
                    done && "bg-muted text-muted-foreground",
                    active && "bg-primary text-primary-foreground",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {done ? <Check aria-hidden className="size-3" /> : null}
                  {step}. {label}
                </span>
                {i < STEP_LABELS.length - 1 ? (
                  <span aria-hidden className="text-muted-foreground">→</span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* 当前阶段 + 在等谁 */}
        <p className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground">
          <span data-testid="research-phase-label" className="font-medium text-background-foreground">
            {C.PHASE_LABELS[phase]}
          </span>

          {waitingGate ? (
            <span
              data-testid="research-waiting-gate"
              className="flex items-center gap-1 rounded bg-warning-tint px-2 py-0.5 text-warning-tint-foreground"
            >
              <UserCheck aria-hidden className="size-3" />
              等你确认：{C.GATE_LABELS[waitingGate]}
            </span>
          ) : (
            // 不等人时也要说一句。空着会让用户以为界面没加载出来——
            // 「没有待办」和「不知道有没有待办」在用户那里是两回事。
            <span data-testid="research-waiting-none">当前无需你确认</span>
          )}

          {publishedGraphVersion > 0 ? (
            <span data-testid="research-published-version">
              已发布图谱 第 {publishedGraphVersion} 版
            </span>
          ) : null}

          {verifyDueAt ? (
            <span data-testid="research-verify-due" className="flex items-center gap-1">
              <Clock aria-hidden className="size-3" />
              验证到期：{new Date(verifyDueAt).toLocaleDateString("zh-CN")}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export { STEP_OF, STEP_LABELS, phaseIndex };
