"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { describeAgentRunError, type AgentRunStatus, type AgentRunView } from "@/lib/agent-run";
import { derivePlanTodos } from "@/components/chat/agent-plan-panel";
import type { DurableMessage, GetAgentPanelOut } from "@/lib/live-chat";
import type { ThreadSkillMount } from "@/lib/live-skill-mount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `chat-live-message-panel.tsx` 拆出：
 * 以下这一批纯函数与两个只消费 props 的展示组件（`AgentRunStatus`/`FailureState`）
 * 不闭包依赖 `ChatLiveMessagePanel` 的任何内部状态，天然可独立成文件。原文件当时
 * 已过 2000 行的业务源文件规模上限（AGENTS.md 硬约束）。行为逐字节未变，唯一改动
 * 是文件边界与 import 路径；`chat-live-message-panel.tsx` 原位置留指针注释并从这里
 * import 回去。
 */

/**
 * #435 —— AgentRun 轮询的有界退避。
 *
 * 契约把 Wave 2 的 run 传输定为**轮询**并要求「有界退避 + 终态停止」
 * （`packages/contracts/src/wave2-runtime.ts:200-202`）。这三个常数就是那个「有界」：
 * 起步 400ms，每次 ×1.5，封顶 3s。
 *
 * ⚠ 超时**不等于**失败。超时只说明「本页面在这段时间内没等到终态」，
 * run 在服务端可能仍在跑。所以超时走 `timedOut` 分支显示「仍在进行」，
 * **不**伪造一个 `failed` —— 那会让界面对用户说谎。
 *
 * ## ⚠⚠ 预算为什么从 90s 提到 20min（2026-08-22 devapp 实测事故）
 *
 * 90s 这个数字是按「模型直接作答」定的。挂了 skill 之后这条链路完全不是那个量级：
 * 沙箱单次脚本上限 120s × 最多 3 次重试，加上每次重新生成脚本的模型调用，
 * 十几分钟是常态。
 *
 * 实测后果（devapp，pptx skill）：run 在 **14 分 18 秒**后以 MODEL_CALL_FAILED
 * 终态失败，而前端**第 90 秒就停止轮询**了 —— 界面永远停在「正在思考…」，
 * 用户在等一个早就死掉的任务。这不是"没做失败态"（`awaitingReply` 早就排除了终态），
 * 是**根本没等到那个终态**。
 *
 * ⚠ 这四个数字此前各自独立、互不知情：前端 90s / deep-agent 300s /
 *   沙箱单次 120s / 重试 3 次。凑在一起必然产生「界面撒谎」。预算现在必须
 *   **覆盖得住最慢的那条真实链路**，否则超时分支就不是"少数派兜底"而是常态。
 */
export const RUN_POLL_FIRST_DELAY_MS = 400;
export const RUN_POLL_BACKOFF = 1.5;
export const RUN_POLL_MAX_DELAY_MS = 3_000;
export const RUN_POLL_BUDGET_MS = 20 * 60_000;

/**
 * 轮询到的 run 观测值。`view` 为 null 表示「还没读到第一份服务端状态」。
 *
 * `authExpired`（issue #1819）—— 读 run 状态时收到 401（`ApiError.status === 401`）。
 * 这不是「这次没读到，下次再试」的可重试失败：bearer 已经过期，接下来每一次轮询
 * 都会撞同一个 401，继续按退避重试没有意义，唯一出路是用户重新登录。单独标出来，
 * 好让轮询 effect 立即停手、`awaitingReply`（「正在思考…」占位）让位给下面
 * `AgentRunStatus` 已经在展示的「登录已失效，请重新登录」文案——而不是让占位动画
 * 与这句文案同屏矛盾地并存到 20 分钟预算耗尽为止。
 */
export interface RunObservation {
  readonly runId: string;
  readonly view: AgentRunView | null;
  readonly failure: string | null;
  readonly timedOut: boolean;
  readonly authExpired: boolean;
}

/**
 * agent 的显示名。从编制（`getAgentPanel` 的结果）里查，查不到回落到 id。
 * ⚠ 回落**不是**糊成「Agent」：查不到通常意味着它已被移出编制，糊掉会让这件事不可见。
 */
export function agentLabel(agentId: string | null, agents: GetAgentPanelOut["agents"] | null): string {
  if (agentId === null) return "Agent";
  return agents?.find((a) => a.id === agentId)?.name ?? agentId;
}

/**
 * agent 的角色 chip。编制里没有这个 agent 时不渲染 —— 不编一个角色出来。
 *
 * #1705（#728 D-1，人类裁决 2026-08-21）—— 这里原来印的是 `duty`（一句话能力描述，
 * 偏长）；D5 身份行的 chip 应该是短头衔，改成 `roleLabel`（同 D2 编制区第一行用的
 * 同一个字段，「Ava · 战略分析师」的后半段），`duty` 那句能力描述留在 D2 编制区
 * 第二行，不在消息气泡这种寸土寸金的行内重复。
 */
export function agentRoleLabel(
  agentId: string | null,
  agents: GetAgentPanelOut["agents"] | null,
): React.ReactNode {
  const roleLabel = agentId === null ? undefined : agents?.find((a) => a.id === agentId)?.roleLabel;
  return roleLabel ? <Badge tone="ai">{roleLabel}</Badge> : null;
}

export const EMPTY_SKILL_MOUNTS: readonly ThreadSkillMount[] = [];
export const EMPTY_SKILL_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * D5（chat-main-fidelity-rubric.md）—— agent 消息身份行的 skill chip。
 *
 * ⚠ 这不是"当前挂了什么"（那是 `hasMountedSkills` 在别处做的事），是"这条消息
 * **发出那一刻**哪个 skill 处于挂载状态"——挂载会被摘除（`removedAt`），把"现在"
 * 的挂载状态套在一条历史消息上会在摘除后变成误导（消息底下印着一个此刻已经不在
 * 挂载列表里的 skill 名字，像是编出来的）。用消息 `createdAt` 落在哪个挂载的
 * `[mountedAt, removedAt)` 时间窗里来判定，是这条消息发出时**真实**处于挂载状态
 * 的 skill，不是近似值。
 *
 * 同一时刻可能有多个 skill 同时挂载——参照图一次只示范一个，这里也只取第一个匹配
 * （按 `mountedAt` 最早的），不在寸土寸金的身份行里塞一整串。
 *
 * 找不到匹配挂载、或该 skill 的名字还没解析出来（`skillNames` 里没有）时不渲染——
 * 不编一个名字出来，也不回落显示裸 `skillId`（那对用户没有意义，且会被误认成又
 * 一个"查不到就显示原值"的角色 chip）。
 */
/**
 * 「在 `atIso` 这一刻处于挂载状态的 skill」——D5（消息身份行）按消息 `createdAt`
 * 回查，issue #2284（composer 顶部上下文行）按「此刻」（`new Date().toISOString()`）
 * 回查，是同一条时间窗判定逻辑，只是喂进去的时间点不同，抽成一个函数避免两处
 * 各写一份、日后改判定规则时只改一处。
 */
export function resolveActiveSkillMount(
  atIso: string,
  skillMounts: readonly ThreadSkillMount[],
): ThreadSkillMount | undefined {
  const at = Date.parse(atIso);
  if (Number.isNaN(at)) return undefined;
  return skillMounts
    .filter((mount) => {
      const mountedAt = Date.parse(mount.mountedAt);
      if (Number.isNaN(mountedAt) || mountedAt > at) return false;
      if (mount.removedAt === null) return true;
      const removedAt = Date.parse(mount.removedAt);
      return Number.isNaN(removedAt) ? true : removedAt > at;
    })
    .sort((a, b) => Date.parse(a.mountedAt) - Date.parse(b.mountedAt))[0];
}

export function agentSkillLabel(
  createdAt: string,
  skillMounts: readonly ThreadSkillMount[],
  skillNames: ReadonlyMap<string, string>,
): React.ReactNode {
  const active = resolveActiveSkillMount(createdAt, skillMounts);
  if (!active) return null;
  const name = skillNames.get(active.skillId);
  if (!name) return null;
  return <Badge tone="neutral">skill: {name}</Badge>;
}

/**
 * 「时:分」。⚠ 刻意不做「几分钟前」：那会让同一条消息在两次渲染间文字不同，
 * 截图比对与快照测试都会因此抖动，换来的信息量为零。
 */
export function messageTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * #435 —— AgentRun 的可见状态。**这是闭环第 8 步在界面上的唯一交付物。**
 *
 * ## 为什么 testid 叫 `chat-live-agent-run-status`
 *
 * 跟随本组件既有的 `chat-live-*` 前缀（本文件 :137 的 `chat-live-message-panel`），
 * 不另造一套命名。`core-loop.spec.ts` 曾断言一个叫 `chat-agent-run-status` 的东西，
 * 那个名字**在整个 `apps/web` 里从不存在** —— 于是步骤 8b 从写下那天起就恒红，
 * 而且红得不是因为 agent 没跑，是因为断言锚在虚空上。同型事故这是第五次。
 *
 * ## 状态取自服务端，不取自本地推断
 *
 * `data-run-status` 直接来自 `GET /agent-runs/:runId` 的 `status` 字段，
 * 是契约状态机的原值（`queued|running|writeback_pending|succeeded|failed`）。
 * 断言方因此可以判「跑到终态了」，而不是判「前端以为它跑完了」。
 *
 * `data-result-message-id` 只在 #413 的写回事务提交后才非空
 * （`wave2-runtime.ts:195` 原文：Non-null only once #413's writeback transaction has
 * committed）。它是「恰好一条回复真的落库了」在 DOM 上的投影。
 */
/**
 * D10（chat-main-fidelity-rubric.md）—— 参照图在 agent 跑批中于输入区上方给一张
 * 行内操作卡（"Ava 正在重排致命假设优先级 2/4 …查看进度/暂停"）。
 *
 * 调查结论：**「暂停」在本仓没有真实能力可接**——`execute-run.ts` 等后端路径没有
 * 任何取消/暂停 run 的操作，契约（`packages/contracts`）里也没有对应端点。做一个
 * 点了没反应（或客户端假装暂停、服务端其实继续跑）的按钮，比不做还坏——那是
 * AGENTS.md 明令禁止的"假交互"。已开数据缺口 issue 跟踪（#2281），不在这里伪造。
 *
 * 「查看进度」**有真实、可连接的行为**：run 进行中时，这条消息自己的思考/工具
 * 调用链（`MessageThinkingChain`/`AgentToolChain`）就渲染在消息流里，点击滚到
 * 最新消息（复用已有的 `scrollToLatest`，与右下角「回到最新」是同一个真实滚动
 * 动作，不是新造一份），用户由此看到实时进度——这不是假按钮。
 *
 * issue #2285（rev-uiux 复评）补两件：
 * 1. **落点**：这张卡此前渲在 composer 内部（`<Textarea>` 之后），DOM 上必然落在
 *    输入框下方。调用点已挪到 `{aboveComposer}` 之后、composer div 之前（见上方
 *    render 调用处），这里只是把外层容器从一条裸文字行换成卡片样式，与
 *    `ChatRecordingPanel` 挂在同一个「输入区上方」位置语义一致。
 * 2. **进度计数**：`derivePlanTodos` 与消息流里「计划 N/M」（`agent-plan-panel.tsx`）
 *    读的是**同一个** `view.steps`——`write_todos` 落的账本本来就在这条 run 的
 *    steps 里，不是新数据源。解析不出计划（模型直接作答、还没调用过 write_todos）
 *    时不显示计数，不编一个 0/0。
 */
export function AgentRunStatus({
  observation, onViewProgress,
}: {
  observation: RunObservation;
  onViewProgress: () => void;
}) {
  const { runId, view, failure, timedOut, authExpired } = observation;
  const status: AgentRunStatus | null = view?.status ?? null;
  const inProgress = status !== null && status !== "succeeded" && status !== "failed";
  const planTodos = view ? derivePlanTodos(view.steps) : null;
  const planDone = planTodos?.filter((t) => t.status === "completed").length ?? null;
  const planTotal = planTodos?.length ?? null;
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-card px-2.5 py-1.5 text-11"
      data-testid="chat-live-agent-run-status"
      data-run-id={runId}
      // 读不到状态时**不填**这个属性，而不是填一个猜的值。
      data-run-status={status ?? undefined}
      data-result-message-id={view?.resultMessageId ?? undefined}
      data-run-error={view?.error ?? undefined}
      // issue #1819 —— 401 是「不可恢复，需重新登录」，与其它可重试失败区分开，
      // 好让测试/未来 UI 不必靠正则匹配文案来判断是不是这一种终态。
      data-run-auth-expired={authExpired || undefined}
    >
      {failure !== null ? <span className="text-destructive">{failure}</span> : null}
      {failure === null && status === null ? (
        <span className="text-muted-foreground">正在读取 AgentRun 状态…</span>
      ) : null}
      {status !== null ? <span className={statusTone(status)}>{RUN_STATUS_TEXT[status]}</span> : null}
      {inProgress && planTotal !== null && planTotal > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-10 text-muted-foreground"
          data-testid="chat-live-agent-run-plan-progress"
          data-plan-done={planDone}
          data-plan-total={planTotal}
        >
          {planDone}/{planTotal}
          <span className="flex items-center gap-0.5" aria-hidden>
            {Array.from({ length: planTotal }).map((_, i) => (
              <span
                // eslint-disable-next-line react/no-array-index-key -- 纯装饰性进度块，无稳定业务 key
                key={i}
                className={`h-1 w-3 rounded-full ${i < (planDone ?? 0) ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </span>
        </span>
      ) : null}
      {inProgress ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="chat-live-agent-run-view-progress"
          onClick={onViewProgress}
        >
          查看进度
        </Button>
      ) : null}
      {/*
        UI 评分 2026-08-23 第 7 项修复——这里此前直接印 `view.error` 的原值
        （如「（MODEL_CALL_FAILED）」），是仅供排障的稳定枚举，不是给用户看的话。
        `describeAgentRunError` 换成人读文案，原始 code 仍在 `title`（悬停/读屏可达，
        不是被抹掉）。完整的失败呈现（含重试入口）在消息流那条 agent 行本身
        （`chat-run-process-failure`），这里是扫读摘要，两处不重复渲染重试按钮。
      */}
      {view?.error ? (
        <span className="text-destructive" title={view.error}>（{describeAgentRunError(view.error)}）</span>
      ) : null}
      {timedOut ? (
        // 超时 ≠ 失败。run 可能还在服务端跑，界面只说自己没等到。
        <span className="text-muted-foreground">本页面已停止轮询，运行可能仍在继续。</span>
      ) : null}
    </div>
  );
}

export const RUN_STATUS_TEXT: Record<AgentRunStatus, string> = {
  queued: "已排队，等待执行",
  running: "正在执行",
  writeback_pending: "已产出，正在写回对话",
  awaiting_approval: "等待你的批准（见上方审批卡）",
  succeeded: "执行完成，回复已写入对话",
  failed: "执行失败",
};

export function statusTone(status: AgentRunStatus): string {
  if (status === "failed") return "text-destructive";
  if (status === "succeeded") return "text-primary";
  return "text-muted-foreground";
}

/*
 * issue #2050 —— 「落地为产物」的状态机 + 展示件已抽到
 * `@/components/chat/message-landing`，本文件不再私有一份：CopilotKit v2 轨道
 * （`copilotkit-v2-panel.tsx`）现在也要这个能力，抄第二份就是本仓硬约束点名的
 * 「同一事实声明在两处」。此处删除的是 `MessageLandingState`/`defaultArtifactTitle`/
 * `MessageLandingControls`/`LandedArtifactCard` 四个定义，**行为逐字未变**（新模块
 * 里的实现是原样搬迁，含 `mode:"draft"` 的既有理由与全部 `data-testid`）。
 */

/** 十项 UX 缺口第 6 项——建议 chip 的形状。`id` 只用于 `data-testid`/`key`，不是服务端概念。 */
export interface FollowUpSuggestion {
  readonly id: string;
  readonly text: string;
}

/**
 * 规则驱动的「建议后续操作」（issue #712）。
 *
 * ⚠ 这**不是** AI 推荐——chat 后端没有任何建议引擎（调查见 issue #712），这里是
 *   纯前端的确定性规则，判据只有「最新一条消息的作者类别」「消息总数」
 *   「线程是否归档」三个已知量，不掺入任何模型调用。点击只**填充**输入框
 *   （复用 `updateDraft`），不自动发送——用户仍需手动确认并点击发送。
 *
 * 规则（按优先级）：
 *   1. 已归档 ⇒ 不建议（只读态，composer 本身已禁用）。
 *   2. 零消息 ⇒ 建议一条通用开场白。
 *   3. 最新一条来自 agent（刚回复完）⇒ 建议两条追问模板。
 *   4. 最新一条来自人类（发完在等 run）⇒ 不建议——避免在等待态堆无意义的 UI。
 */
export function computeFollowUpSuggestions(
  messages: readonly DurableMessage[],
  archived: boolean,
): readonly FollowUpSuggestion[] {
  if (archived) return [];
  if (messages.length === 0) {
    return [{ id: "opener", text: "简要说明一下这次想解决的问题" }];
  }
  const latest = messages[messages.length - 1]!;
  if (latest.authorKind === "agent") {
    return [
      { id: "elaborate", text: "能否再详细说明一下？" },
      { id: "summarize", text: "谢谢，请总结一下要点" },
    ];
  }
  return [];
}

export function appendUnique(current: DurableMessage[], incoming: DurableMessage[]): DurableMessage[] {
  const seen = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !seen.has(message.id))];
}

export function newClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function FailureState({
  testId,
  message,
  onRetry,
}: {
  testId?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2" data-testid={testId}>
      <p className="text-11 text-destructive">{message}</p>
      <Button size="xs" variant="outline" data-testid={testId ? `${testId}-retry` : "chat-message-submit-retry"} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-3 w-3" />重试
      </Button>
    </div>
  );
}

// `describeMessageFailure` 本体移到 `@/lib/live-chat`（VZ-fabric 真实保存接线）：
// `chat-diagram-canvas-modal.tsx` 也要用它，而它经 `markdown-message.tsx` →
// `chat-diagram-fabric.tsx` 被本文件引入——若本体还留在本文件会成环
// （本文件→markdown-message→chat-diagram-fabric→chat-diagram-canvas-modal→本文件）。
// 这里保留一个**再导出**，让既有从本文件导入它的调用点（`chat-skill-mount-panel.tsx`、
// `chat-read-screen.test.tsx`）不必跟着改路径——再导出指向叶子模块，不构成新的环。
export { describeMessageFailure } from "@/lib/live-chat";
