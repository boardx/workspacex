"use client";
import * as React from "react";
import {
  ChevronRight, CheckCircle2, XCircle, Wrench, Loader2, FileSearch, FileText, Clock, ListTodo,
} from "lucide-react";
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
export function toolChainSummaryText(steps: Step[], running = false): string {
  const seconds = deriveThinkingSeconds(steps);
  const toolSteps = steps.filter((s) => s.kind === "tool_call");
  const head = seconds !== null && seconds > 0 ? `思考了 ${seconds} 秒 · ` : "";
  // UI 复评 2026-08-23：run 进行中折叠头曾先说「模型直接作答」、几秒后改口
  // 「调用了 2 个工具」——自相矛盾（第 2 项判 0 的第二条依据）。进行中零工具
  // 只是「还没到」，不是结论；结论只在终态下。
  if (toolSteps.length === 0) return running ? `${head}正在执行…` : `${head}模型直接作答`;
  // UI 评分 2026-08-23 第 3 项判 0 的直接依据：「调用参数摘要在任何一张图里都没
  // 露出，默认视图对用户仍是黑盒」。收起态在计数后带首个工具的 名称(参数片段)，
  // 参数截 40 字符——够认出「调的什么、拿什么调的」，不够把折叠头挤成第二个正文。
  // write_todos 这类结构化参数只显示工具名（JSON 片段对人没有信息量）。
  // UI 复评第 3 项：「等 2 个工具」把第二个工具名吞了，且参数一个字没露。
  // 逐个列出前两个工具的 名称(参数片段)，write_todos 显示「N 项计划」而非 JSON。
  const label = (s0: Step): string => {
    if (s0.toolName === null) return "工具";
    if (s0.toolName === "write_todos") {
      let n: number | null = null;
      try {
        const parsed = s0.toolArgsSummary === null ? null : (JSON.parse(s0.toolArgsSummary) as { todos?: unknown[] });
        n = Array.isArray(parsed?.todos) ? parsed.todos.length : null;
      } catch { /* 解析不了就只显名 */ }
      return n === null ? "write_todos" : `write_todos(${n} 项计划)`;
    }
    const brief = s0.toolArgsSummary !== null && s0.toolArgsSummary !== ""
      ? `(${s0.toolArgsSummary.slice(0, 32)}${s0.toolArgsSummary.length > 32 ? "…" : ""})`
      : "()";
    return `${s0.toolName}${brief}`;
  };
  const listed = toolSteps.slice(0, 2).map(label).join(" · ");
  const extra = toolSteps.length > 2 ? ` 等 ${toolSteps.length} 个工具` : "";
  return `${head}调用了 ${listed}${extra}`;
}

export function AgentToolChain({
  steps,
  defaultOpen = false,
  running = false,
  runFailed = false,
}: {
  steps: Step[];
  defaultOpen?: boolean;
  /** run 未终态：零工具时说「正在执行…」而非下「模型直接作答」的结论。 */
  running?: boolean;
  /**
   * UX-9 track B 第 7 项修复（2026-08-23 回归）—— run 本身以 `failed` 终态收场，
   * 但失败点可能不在任何一次工具调用上（例如 MODEL_CALL_FAILED：模型调用本身没
   * 返回可用内容，`toolSteps` 里每一步都是 `succeeded`）。此前折叠头只看
   * `failCount`（工具调用失败数），于是这种情况下收起态照样是绿色 ✓，与「执行
   * 失败」的整体结论矛盾。这个 flag 让折叠头知道「这一整条 run 失败了」，
   * 不是从 `steps` 里反推出来的——反推不出：工具全部成功、run 仍能失败，
   * 两件事各有各的事实源。
   */
  runFailed?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  // V6 与活体一致：只要 run 有任何 step 就展示折叠块，不要求有工具调用才渲染。
  if (steps.length === 0) return null;

  const toolSteps = steps.filter((s) => s.kind === "tool_call");
  const failCount = toolSteps.filter((s) => s.status === "failed").length;
  // #742 Gap 1：至少有一个工具调用还没落终态——折叠头也要能不点开就看到「还在跑」，
  // 不是只有展开态那一张卡片知道。失败徽标优先于它：已经出的错比还在跑的调用更要紧。
  const inProgressCount = toolSteps.filter((s) => s.status === "in_progress").length;
  const summary = toolChainSummaryText(steps, running);

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
          ) : inProgressCount > 0 ? (
            <Badge tone="neutral" data-testid="agent-tool-chain-in-progress-badge">
              <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" />
              进行中
            </Badge>
          ) : runFailed ? (
            // 每一步工具调用都成功，但 run 整体仍以 failed 收场（如 MODEL_CALL_FAILED）——
            // 绿色 ✓ 在这里是假的：它只回答了「工具调没调成」，没回答「这次执行成没成」。
            <Badge tone="danger" data-testid="agent-tool-chain-run-failed-badge">
              <XCircle aria-hidden className="h-2.5 w-2.5" />
              执行失败
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

/** 折叠态徽标：三态（进行中/完成/失败），复用同一套图标语言。 */
function StepStatusBadge({ status }: { status: Step["status"] }) {
  if (status === "in_progress") {
    return (
      <Badge tone="neutral" data-testid="agent-tool-chain-step-in-progress-badge">
        <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" />进行中
      </Badge>
    );
  }
  if (status === "succeeded") {
    return <Badge tone="primary"><CheckCircle2 aria-hidden className="h-2.5 w-2.5" />完成</Badge>;
  }
  return <Badge tone="danger"><XCircle aria-hidden className="h-2.5 w-2.5" />失败</Badge>;
}

/** #742 Gap 4 支撑：`toolArgsSummary` 是 JSON 字符串（`write_todos`/`search_documents`/
 * `read_document` 皆如此），解析失败就返回 `null`——per-tool 卡片据此退化，绝不假装解析成功。 */
function tryParseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const TODO_STATUS_TEXT: Record<string, string> = {
  pending: "待办", in_progress: "进行中", completed: "已完成",
};

/** `write_todos` 展开态：真实的计划条目列表，不是一坨 JSON。 */
function WriteTodosCard({ step }: { step: Step }) {
  const parsed = tryParseJsonObject(step.toolArgsSummary);
  const todos = Array.isArray(parsed?.todos) ? (parsed!.todos as unknown[]) : null;
  if (todos === null) return <GenericToolBody step={step} />;
  return (
    <ul className="mt-1 flex flex-col gap-0.5" data-testid="agent-tool-chain-write-todos-list">
      {todos.map((t, i) => {
        const todo = t as { content?: unknown; status?: unknown };
        const content = typeof todo.content === "string" ? todo.content : null;
        const status = typeof todo.status === "string" ? todo.status : null;
        if (content === null) return null;
        return (
          <li key={i} className="flex items-center gap-1.5 text-10">
            <ListTodo
              aria-hidden
              className={cn(
                "h-3 w-3 shrink-0",
                status === "completed" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className={cn("min-w-0 flex-1 truncate", status === "completed" && "text-muted-foreground line-through")}>
              {content}
            </span>
            {status !== null ? (
              <span className="shrink-0 text-muted-foreground">{TODO_STATUS_TEXT[status] ?? status}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** `search_documents` 展开态：结果渲成文档条目列表——从摘要文本里抽出「看起来像文件名」的
 * token（`xxx.ext`）。抽不出任何文件名就老实退化成原文本，不编一个空列表。 */
function SearchDocumentsCard({ step }: { step: Step }) {
  const args = tryParseJsonObject(step.toolArgsSummary);
  const query = typeof args?.query === "string" ? args.query : null;
  const files = step.toolResultSummary !== null
    ? [...step.toolResultSummary.matchAll(/[^\s，,。:：]+\.[A-Za-z0-9]{1,6}/g)].map((m) => m[0])
    : [];
  return (
    <div className="mt-1" data-testid="agent-tool-chain-search-documents-card">
      {query !== null ? (
        <p className="flex items-center gap-1.5 text-10 text-muted-foreground">
          <FileSearch aria-hidden className="h-3 w-3 shrink-0" />检索词：{query}
        </p>
      ) : null}
      {step.toolResultSummary === null ? null : files.length > 0 ? (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5 text-10 text-card-foreground">
              <FileText aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-10 text-card-foreground">{step.toolResultSummary}</p>
      )}
    </div>
  );
}

/** `read_document` 展开态：文件名单独一行，正文预览另起一段——不是「参数 JSON + 结果 JSON」
 * 拼一起的通用卡片。 */
function ReadDocumentCard({ step }: { step: Step }) {
  const args = tryParseJsonObject(step.toolArgsSummary);
  const path = typeof args?.path === "string" ? args.path : null;
  return (
    <div className="mt-1" data-testid="agent-tool-chain-read-document-card">
      {path !== null ? (
        <p className="flex items-center gap-1.5 text-10 font-medium text-card-foreground">
          <FileText aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />{path}
        </p>
      ) : null}
      {step.toolResultSummary !== null ? (
        <p className="mt-0.5 rounded-sm border border-border-subtle bg-muted px-1.5 py-1 text-10 text-card-foreground">
          {step.toolResultSummary}
        </p>
      ) : null}
    </div>
  );
}

/** `lookup_time` 展开态：把结果里的 ISO 时间戳单独摘出来加粗，不是一整行原文。抽不出就
 * 原样显示——绝不假装解析出一个时间。 */
function LookupTimeCard({ step }: { step: Step }) {
  const match = step.toolResultSummary?.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/) ?? null;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-10" data-testid="agent-tool-chain-lookup-time-card">
      <Clock aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
      {match !== null ? (
        <span className="font-mono font-medium text-card-foreground">{match[0]}</span>
      ) : step.toolResultSummary !== null ? (
        <span className="text-card-foreground">{step.toolResultSummary}</span>
      ) : null}
    </div>
  );
}

/** 兜底通用卡片：没有专属渲染的工具走这条——「参数 JSON + 结果 JSON」文本布局，逐字保留
 * 本组件原有行为。 */
function GenericToolBody({ step }: { step: Step }) {
  const failed = step.status === "failed";
  return (
    <>
      {step.toolArgsSummary ? (
        <p className="mt-1 font-mono text-10 text-muted-foreground">参数：{step.toolArgsSummary}</p>
      ) : null}
      {step.toolResultSummary ? (
        <p className={cn("mt-0.5 text-10", failed ? "text-destructive" : "text-card-foreground")}>
          {failed ? "失败原因" : "结果"}：{step.toolResultSummary}
        </p>
      ) : null}
    </>
  );
}

/** #742 Gap 4：按 `toolName` 分发到贴合数据形状的展示分支；其余工具兜底走
 * `GenericToolBody`（不要求覆盖所有工具）。只在终态（非 `in_progress`）下分发——进行中
 * 态还没有 `toolResultSummary` 可供任何一个专属卡片消费，统一走 Gap 1 的进行中提示。 */
function ToolChainStepBody({ step }: { step: Step }) {
  switch (step.toolName) {
    case "write_todos": return <WriteTodosCard step={step} />;
    case "search_documents": return <SearchDocumentsCard step={step} />;
    case "read_document": return <ReadDocumentCard step={step} />;
    case "lookup_time": return <LookupTimeCard step={step} />;
    default: return <GenericToolBody step={step} />;
  }
}

function ToolChainStep({ step, index }: { step: Step; index: number }) {
  const inProgress = step.status === "in_progress";
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
        {inProgress ? (
          // #742 Gap 1：脉动图标——工具调用开始时就有真实记账（`in_progress` 步骤），
          // 用户此刻看到的是「正在调用」，不是等到终态才第一次出现在 steps 里。
          <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
          {inProgress ? "正在调用 " : "调用 "}{step.toolName ?? "未知工具"}
        </span>
        <StepStatusBadge status={step.status} />
      </div>
      {inProgress ? (
        <>
          {step.toolArgsSummary ? (
            <p className="mt-1 font-mono text-10 text-muted-foreground">参数：{step.toolArgsSummary}</p>
          ) : null}
          <p className="mt-0.5 text-10 text-muted-foreground" data-testid={`agent-tool-chain-in-progress-${index}`}>
            正在调用…结果尚未返回
          </p>
        </>
      ) : (
        <ToolChainStepBody step={step} />
      )}
    </li>
  );
}
