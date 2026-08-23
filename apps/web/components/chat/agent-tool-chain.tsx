"use client";
import * as React from "react";
import { ChevronRight, CheckCircle2, XCircle, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentRunView } from "@/lib/agent-run";

/**
 * agent-tool-chain（TOOLCHAIN-01：活体 run 工具调用链折叠式内联展示）—— 活体生产组件。
 * `chat-live-message-panel.tsx` 直接渲染它（吃 `runObservation.view.steps`，无新接口）。
 *
 * ## 它替换了什么
 * 旧的 `AgentRunToolCallSteps` 用 `<details open>` **默认全展开**，常驻 composer 下方把
 * 界面往上挤，逐条铺开「调用 X ✓完成 / 参数:{} / 结果:…」。本组件对齐持久消息 `ToolCalls`
 * （`ai-message.tsx` 第 82 行）的 Claude-Code 风折叠语言：默认收起成**一行**摘要
 * （`思考了 3.2 秒 · 调用了 3 个工具 ✓`），点开才展开逐条参数/结果/终态。
 *
 * ## 默认收起 —— 人类已裁决（2026-08-13，方案 A）
 * 旧块的 `open` 是**故意**的：P7（round 17 的 10/10）判据曾要求参数/终态默认可见。
 * 本次人类明确重裁**采用方案 A：默认收起 + 一行摘要**（ADR-023 ① UI 签核增量），
 * 反转该旧判据。信息不丢——展开一键可达，且**失败在收起态就以红徽标显性**
 * （见下方 `agent-tool-chain-fail-badge`），P7 真正在意的「出错看得见」未被折叠藏起。
 * `defaultOpen` 默认 false（生产默认收起）；预览页传 true 以同屏展示展开态。
 *
 * ## 数据形状
 * 吃 `AgentRunView["steps"]`（活体轮询里已有，无新接口）。`toolName` /
 * `toolArgsSummary` / `toolResultSummary` / `planningNote` 任一为 `null` 就**不渲染那行**，
 * 绝不用占位文案顶替（沿用活体既有纪律）。
 */

type Step = AgentRunView["steps"][number];

/**
 * 从 run 的真实 steps 派生「思考了 X 秒」。逻辑与活体 `deriveThinkingSummary` 一致：
 * 秒数 = 最晚 endedAt − 最早 startedAt；任一无法解析则 `seconds: null`，摘要退化只显步/工具数，
 * 绝不编一个耗时出来。
 */
export function deriveThinkingSeconds(steps: Step[]): number | null {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    const start = Date.parse(step.startedAt);
    const end = Date.parse(step.endedAt);
    if (!Number.isNaN(start)) minStart = Math.min(minStart, start);
    if (!Number.isNaN(end)) maxEnd = Math.max(maxEnd, end);
  }
  const spanValid = Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd >= minStart;
  return spanValid ? Math.round(((maxEnd - minStart) / 1000) * 10) / 10 : null;
}

/**
 * 收起态一行摘要文案：秒数缺失退化为不带秒；无工具调用时说「模型直接作答」。
 *
 * 2026-08-19 人类实测反馈（#1589）：`思考了 0 秒` 读起来像自相矛盾（既然是 0 秒，那还
 * 调用了 3 个工具？听起来像埋点坏了，不是"很快"）。`deriveThinkingSeconds` 四舍五入到
 * 0.1 秒精度，真落到 0.0 的多半是 startedAt===endedAt 这类边界（极快，不是没有过程）。
 * `seconds === 0` 与 `seconds === null`（缺失）同等处置——都退化成不带秒的文案，
 * 而不是印出一个会被读成"没思考"的数字。`> 0` 而非 `!== null` 是这处修复的全部。
 */
export function toolChainSummaryText(steps: Step[]): string {
  const seconds = deriveThinkingSeconds(steps);
  const toolSteps = steps.filter((s) => s.kind === "tool_call");
  const head = seconds !== null && seconds > 0 ? `思考了 ${seconds} 秒 · ` : "";
  if (toolSteps.length === 0) return `${head}模型直接作答`;
  // UI 评分 2026-08-23 第 3 项判 0 的直接依据：「调用参数摘要在任何一张图里都没
  // 露出，默认视图对用户仍是黑盒」。收起态在计数后带首个工具的 名称(参数片段)，
  // 参数截 40 字符——够认出「调的什么、拿什么调的」，不够把折叠头挤成第二个正文。
  // write_todos 这类结构化参数只显示工具名（JSON 片段对人没有信息量）。
  const first = toolSteps[0]!;
  const argsBrief =
    first.toolName !== "write_todos" && first.toolArgsSummary !== null && first.toolArgsSummary !== ""
      ? `(${first.toolArgsSummary.slice(0, 40)}${first.toolArgsSummary.length > 40 ? "…" : ""})`
      : "";
  const firstLabel = first.toolName !== null ? ` ${first.toolName}${argsBrief}` : "";
  const extra = toolSteps.length > 1 ? ` 等 ${toolSteps.length} 个工具` : "";
  return `${head}调用了${firstLabel}${extra}`;
}

export function AgentToolChain({
  steps,
  defaultOpen = false,
}: {
  steps: Step[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  // V6 与活体一致：只要 run 有任何 step 就展示折叠块，不要求有工具调用才渲染。
  if (steps.length === 0) return null;

  const toolSteps = steps.filter((s) => s.kind === "tool_call");
  const failCount = toolSteps.filter((s) => s.status === "failed").length;
  const summary = toolChainSummaryText(steps);

  return (
    <div
      className="rounded-md border border-border-subtle bg-card"
      data-testid="agent-tool-chain"
      data-tool-count={toolSteps.length}
      data-fail-count={failCount}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="agent-tool-chain-toggle"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-11 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate text-left font-medium" data-testid="agent-tool-chain-summary">
          {summary}
        </span>
        {/* 收起态就要能表达终态：全绿 ✓，有失败则红色计数（不用点开就看到出事了）*/}
        {toolSteps.length > 0 && (
          failCount > 0 ? (
            <Badge tone="danger" data-testid="agent-tool-chain-fail-badge">
              <XCircle aria-hidden className="h-2.5 w-2.5" />
              {failCount} 个失败
            </Badge>
          ) : (
            <CheckCircle2
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-primary"
              data-testid="agent-tool-chain-ok"
            />
          )
        )}
      </button>

      {open && (
        <div className="border-t border-border-subtle p-2" data-testid="agent-tool-chain-detail">
          {toolSteps.length === 0 ? (
            <p className="px-1 py-0.5 text-11 text-muted-foreground" data-testid="agent-tool-chain-no-tools">
              本次没有工具调用，模型直接作答。
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {toolSteps.map((step, i) => (
                <ToolChainStep key={i} step={step} index={i} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function ToolChainStep({ step, index }: { step: Step; index: number }) {
  const succeeded = step.status === "succeeded";
  return (
    <li
      className="rounded-sm border border-border-subtle bg-card px-2 py-1.5"
      data-testid={`agent-tool-chain-step-${index}`}
      data-tool-name={step.toolName ?? undefined}
      data-tool-status={step.status}
    >
      {step.planningNote ? (
        // 工具调用前模型的可见计划：真实来自模型同一轮回复，没说就不显示，绝不编。
        <p className="mb-1 text-10 italic text-muted-foreground" data-testid={`agent-tool-chain-plan-${index}`}>
          {step.planningNote}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5 text-11">
        <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
          调用 {step.toolName ?? "未知工具"}
        </span>
        {succeeded ? (
          <Badge tone="primary"><CheckCircle2 aria-hidden className="h-2.5 w-2.5" />完成</Badge>
        ) : (
          <Badge tone="danger"><XCircle aria-hidden className="h-2.5 w-2.5" />失败</Badge>
        )}
      </div>
      {step.toolArgsSummary ? (
        <p className="mt-1 font-mono text-10 text-muted-foreground">参数：{step.toolArgsSummary}</p>
      ) : null}
      {step.toolResultSummary ? (
        <p className={cn("mt-0.5 text-10", succeeded ? "text-card-foreground" : "text-destructive")}>
          {succeeded ? "结果" : "失败原因"}：{step.toolResultSummary}
        </p>
      ) : null}
    </li>
  );
}
