"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import {
  phaseLabelForKind, phaseLabelForToolName, phaseLabelForCallSkillArgs, CALL_SKILL_TOOL_NAME,
} from "./agent-run-phase";

/**
 * CK-P4（issue #2054）—— v2 轨道的 run 进度透明度：已耗时 / 阶段文案 / 45s longrun 提示。
 *
 * 差距单一事实源 `.harness/state/chat-feature-parity-gap-2026-08-25.md` 第 9 项：旧轨道
 * 有一整套，v2 只有 `agent.isRunning`（发送按钮变「…」）。用户的实际体验是：长任务
 * 期间界面**完全静止**，第 10 秒和第 10 分钟长得一模一样，分不清"在跑"和"卡死了"。
 *
 * ## 数据来源：v2 侧真实拿得到什么（先核实，再决定做哪几维）
 *
 * 旧轨道这几维全部读 `GET /api/agent-runs/{id}` 的 `AgentRunView.steps`（轮询）。v2
 * **没有**这条轮询——它拿到的是 AG-UI 事件流。逐维核实结果：
 *
 *   · **已耗时** —— ✅ 真实可得，而且不需要任何后端字段：`RUN_STARTED` 到达的那一刻
 *     就是这一轮 run 在客户端可观测的起点。⚠ 用 `RUN_STARTED` 事件而不是
 *     `agent.isRunning` 翻转，是因为后者是 CopilotKit 在**发出请求时**就置位的乐观
 *     状态，把网络往返也算进"已用 N 秒"里；`RUN_STARTED` 是服务端真的开始跑了。
 *   · **45s longrun 提示** —— ✅ 同一个计时器派生，不需要新数据。
 *     ⚠ 措辞比旧轨道**收窄**：旧轨道按 `hasMountedSkills` 分岔成"执行 skill 脚本时
 *     可能需要数分钟"/"复杂任务可能需要数分钟"，而 v2 面板 body 里没有本线程已挂载
 *     skill 的状态（`ChatSkillMountPanel` 自持，不上抛）。宁可只说通用那句，也不猜
 *     一个可能错的归因——issue #1803 gap #4 正是被这句错归因坑过一次。
 *   · **阶段文案** —— ✅ 真实可得，但来源不同：`onToolCallStartEvent`（工具名）、
 *     `onRunStartedEvent`、`onTextMessageStartEvent`。措辞从 `agent-run-phase.ts`
 *     取词，不复制第二份字符串（见那边 `phaseLabelForToolName` 的注释）。
 *     issue #2321 round 3 —— 一个线程可能同时挂了 pdf-create/docx-create/
 *     xlsx-create 好几个技能，"正在执行技能脚本…" 不说是哪一个。`call_skill`
 *     这条 TOOL_CALL_START 之后紧跟的 `TOOL_CALL_ARGS`
 *     （`copilotkit-agui.controller.ts` 把整段 `toolArgsSummary` 一次性当
 *     `delta` 发出，不是逐 token 流式——见该文件 `write` 那处调用点）带的就是
 *     `{skill_stable_name, task}` 那段真实 JSON，`onToolCallArgsEvent` 解析出
 *     `skill_stable_name` 后把阶段文案加细成"正在执行技能脚本（pdf-create）…"。
 *     解析失败（非 call_skill 工具、JSON 形状不对）一律保留 START 时已经设好的
 *     那句通用文案，不猜、不报错。
 *   · **上下文快照 L1-L3（`MessageContextSnapshot`）/ 逐条思考链
 *     （`MessageThinkingChain`）/ `AgentRunStatus` 权威状态条** —— ❌ v2 侧**没有**
 *     真实数据源：这三样读的都是 `AgentRunView` 上 AG-UI 协议里根本不存在的字段
 *     （上下文层级、思考步骤明细、权威 run 状态）。本轮如实登记为不做，写进 backlog，
 *     不伪造一个看起来像那么回事的假面板。
 *
 * ## 为什么阶段文案落在 `TEXT_MESSAGE_START` 上是「正在回复…」
 *
 * 旧轨道的 `chat_writeback` 是"回复已经生成完、正在写回 chat"，而 v2 的
 * `TEXT_MESSAGE_START` 是"第一个 token 出来了"——这是两件事，不能借用那句文案。
 * 这里给一句只断言观测到的事实的新措辞。同一条纪律：宁可笼统，不可编造归因。
 */

/** 超过这个时长就挂 longrun 提示。与旧轨道 `chat-live-message-panel.tsx` 同一个阈值。 */
export const LONG_RUN_THRESHOLD_MS = 45_000;

export const LONG_RUN_HINT = "复杂任务可能需要数分钟";

/** `TEXT_MESSAGE_START` 的阶段文案——见文件头"为什么不借用 `chat_writeback`"。 */
export const REPLYING_PHASE_LABEL = "正在回复…";

/**
 * PROP-CHAT-UIUX-ITER-002 V2 —— 宏观阶段分组，三桶：`preparing`/`acting`/`replying`。
 *
 * ⚠ 这不是重开 TW-P0-3①（六态工作流指示器，`chat-task-workbench-workflow-states.spec.ts`）
 * ——那是 `PlanPhaseIndicator`/`plan-control` 契约束的活（`preparing/planning/executing/
 * awaiting-approval/completed/failed`，读计划账本），本组件不产出、不消费那六态，
 * 两套指示器各自独立、互不替代。这里只是给已有的一行自由文本阶段（`phaseLabel`）
 * 追加一个更粗粒度的分组，方便一眼看出"大致在哪一段"，不是重新做一遍状态机。
 *
 * ## 为什么只有三桶，不是仿反馈建议的四/五段式
 *
 * 三桶精确对应本 hook 已经在监听的三类事件（`onRunStartedEvent` /
 * `onToolCallStartEvent` / `onTextMessageStartEvent`），每一桶都有真实事件支撑；
 * 反馈建议的"理解任务/制定计划/搜索分析/生成结果"四段在 v2 的 AG-UI 事件流里没有
 * 一一对应的信号（例如"制定计划"与"搜索分析"在事件流上都只是若干次
 * `TOOL_CALL_START`，无法可靠区分），拆出比这更细的桶就要么合并落回同一事件、
 * 要么开始猜——本仓纪律是宁可粗一点，不可编一个假分类（同文件头"宁可笼统，不可
 * 编造归因"）。
 */
export type RunStage = "preparing" | "acting" | "replying";

/**
 * 2026-09-02（人类：处理过程要明晰、时间久时要看到 plan / execute 的过程）——
 * 这一轮 run 的**逐步时间线**。每一步都是真实 AG-UI 事件的投影：
 *   · `prepare`：`RUN_STARTED` 到第一条工具调用之间（"正在准备…"）。
 *   · `tool`：一条 `TOOL_CALL_START`（id = toolCallId），文案与阶段文案同源
 *     （`agent-run-phase.ts`），`call_skill` 的参数到达后加细成具体技能名；
 *     `TOOL_CALL_RESULT` 到达、或下一步开始时结束。
 *   · `reply`：`TEXT_MESSAGE_START`（第一个 token 出来了）。
 * 没有事件就没有步骤——不编"第 N 步"。`endedAt === null` 表示仍在进行。
 */
export interface RunStep {
  readonly id: string;
  readonly kind: "prepare" | "tool" | "reply";
  readonly label: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface RunProgress {
  /** 服务端 `RUN_STARTED` 到达的时刻（epoch ms）；本轮还没开始跑时为 `null`。 */
  readonly startedAt: number | null;
  /** 已耗时秒数（整秒，每秒推进）；`startedAt` 为 `null` 时为 `null`。 */
  readonly elapsedSeconds: number | null;
  /** 当前阶段文案；还没有任何可翻译的事件到达时为 `null`（调用方不显示阶段）。 */
  readonly phaseLabel: string | null;
  /** `phaseLabel` 的宏观分组；`phaseLabel` 为 `null` 时同为 `null`。 */
  readonly stage: RunStage | null;
  /** 已经跑够 `LONG_RUN_THRESHOLD_MS`。 */
  readonly isLongRun: boolean;
  /** 本轮的逐步时间线（见 `RunStep`）；不在跑时为空数组。 */
  readonly steps: readonly RunStep[];
  /** 与 `elapsedSeconds` 同一个每秒推进的时钟，供调用方算每一步的进行中时长。 */
  readonly now: number;
}

export function useCopilotKitV2RunProgress(agent: AbstractAgent, isRunning: boolean): RunProgress {
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [phaseLabel, setPhaseLabel] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<RunStage | null>(null);
  const [steps, setSteps] = React.useState<readonly RunStep[]>([]);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  /** 结束所有仍在进行的步骤，再（可选）追加一步。 */
  const advance = (next: RunStep | null) => {
    const at = Date.now();
    setSteps((prev) => {
      const closed = prev.map((s) => (s.endedAt === null ? { ...s, endedAt: at } : s));
      return next === null ? closed : [...closed, next];
    });
  };
  // issue #2321 round 3 -- `TOOL_CALL_ARGS` carries only `toolCallId` (see
  // `ToolCallArgsEventSchema`), not the tool's name; remember it from the matching
  // `TOOL_CALL_START` so we know whether an incoming args delta is worth parsing.
  const toolCallNameByIdRef = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => {
        setStartedAt(Date.now());
        toolCallNameByIdRef.current.clear();
        // "accepted" 是旧轨道 run 生命周期里的第一条 step，语义与 `RUN_STARTED`
        // 对应（服务端受理了这一轮），取同一句词。
        setPhaseLabel(phaseLabelForKind("accepted"));
        setStage("preparing");
        setSteps([{ id: "prepare", kind: "prepare", label: phaseLabelForKind("accepted"), startedAt: Date.now(), endedAt: null }]);
      },
      onToolCallStartEvent: ({ event }) => {
        toolCallNameByIdRef.current.set(event.toolCallId, event.toolCallName);
        const label = phaseLabelForToolName(event.toolCallName ?? null);
        setPhaseLabel(label);
        setStage("acting");
        advance({ id: event.toolCallId, kind: "tool", label, startedAt: Date.now(), endedAt: null });
      },
      onToolCallResultEvent: ({ event }) => {
        const at = Date.now();
        setSteps((prev) => prev.map((s) => (s.id === event.toolCallId && s.endedAt === null ? { ...s, endedAt: at } : s)));
      },
      // issue #2321 round 3 -- `call_skill(skill_stable_name, task)`'s real args,
      // echoed verbatim (see this file's head doc for why this refines rather than
      // replaces the START label, and never fabricates on a parse miss).
      onToolCallArgsEvent: ({ event }) => {
        if (toolCallNameByIdRef.current.get(event.toolCallId) !== CALL_SKILL_TOOL_NAME) return;
        try {
          const parsed: unknown = JSON.parse(event.delta);
          const skillStableName = (parsed as { skill_stable_name?: unknown } | null)?.skill_stable_name;
          if (typeof skillStableName === "string" && skillStableName.trim() !== "") {
            const refined = phaseLabelForCallSkillArgs(skillStableName);
            setPhaseLabel(refined);
            setSteps((prev) => prev.map((s) => (s.id === event.toolCallId ? { ...s, label: refined } : s)));
          }
        } catch {
          // 非 JSON / 形状不对：保留 START 时已经设好的通用文案，不猜、不报错。
        }
      },
      onTextMessageStartEvent: () => {
        setPhaseLabel(REPLYING_PHASE_LABEL);
        setStage("replying");
        setSteps((prev) => (prev.some((s) => s.kind === "reply" && s.endedAt === null)
          ? prev
          : [...prev.map((s) => (s.endedAt === null ? { ...s, endedAt: Date.now() } : s)),
            { id: `reply-${prev.length}`, kind: "reply" as const, label: REPLYING_PHASE_LABEL, startedAt: Date.now(), endedAt: null }]));
      },
      // 终态：不留着上一轮的计时器和阶段继续显示——那会让"上一轮跑了 3 分钟"
      // 在下一轮开始前一直挂在界面上，读起来像这一轮已经在跑。
      onRunFinishedEvent: () => {
        setStartedAt(null);
        setPhaseLabel(null);
        setStage(null);
        setSteps([]);
      },
      onRunErrorEvent: () => {
        setStartedAt(null);
        setPhaseLabel(null);
        setStage(null);
        setSteps([]);
      },
    });
    return unsubscribe;
  }, [agent]);

  /**
   * ⚠ 计时器只在真的有一轮在跑时才起——常驻 `setInterval` 会让这个面板在完全空闲的
   * 页面上每秒重渲染一次整棵消息树。
   */
  React.useEffect(() => {
    if (startedAt === null) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // `isRunning` 为 false 时不报告进度：CopilotKit 的乐观 `isRunning` 与服务端
  // `RUN_STARTED`/`RUN_FINISHED` 之间总有一小段窗口，以"两边都认为在跑"为准，
  // 不在任何一边单独为真时显示一个半截的进度行。
  const active = isRunning && startedAt !== null;
  const elapsedMs = active ? Math.max(0, nowTick - startedAt) : 0;

  return {
    startedAt: active ? startedAt : null,
    elapsedSeconds: active ? Math.floor(elapsedMs / 1_000) : null,
    phaseLabel: active ? phaseLabel : null,
    stage: active ? stage : null,
    isLongRun: active && elapsedMs > LONG_RUN_THRESHOLD_MS,
    steps: active ? steps : [],
    now: nowTick,
  };
}
