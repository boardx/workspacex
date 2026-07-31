/**
 * 线程卡徽标 —— **唯一的一处计算**（chat 束 domain.md I-13 / I-14 / I-15，uc-8-1 R7）。
 *
 * ## 「同源」在这里是什么形状
 *
 * I-13 要求线程卡的「N 条待复核」与消息头的「待复核 N」两处数值**恒相等**。
 * 让两个数相等有两种做法：
 *
 *   ① 两处各算一次，再写一条断言说它们相等；
 *   ② 只有一处算得出来，另一处没有别的算法可用。
 *
 * ①在写下的那一刻是对的，在第三个调用点出现的那一天失效——而失效那天没有人会收到通知。
 * 所以这里取②：**一条消息带不带 `review-pending` 只由 `messageBadges()` 回答**，
 * 列表侧的 N 是对同一个函数的计数（`reviewPendingCount`），详情侧的 N 是同一个函数的
 * 逐条输出。两处不是「碰巧相等」，是**同一次计算的两种投影**。
 *
 * 机械门控在 `tests/chat/thread-badge-single-source.test.ts`：
 *   · 值断言：`card 的 N === detail 里带 review-pending 的消息数`；
 *   · **静态断言**：全仓 `apps/api/src` 里读 `reviewPending` / `review_pending` 的地方
 *     只能是本文件与仓储的那一次 SELECT。任何第二处求和（哪怕结果碰巧一样）当场变红。
 *     ——「值相等」的断言对「两处各算一次」是绿的，只有静态那条能抓住它。
 *
 * ## I-14：`● 转录中` 是**状态**，不是最后活动时间的函数
 *
 * `transcribing` 由调用方传入一个**真实的转录会话事实**（`chat_transcript_sessions` 里
 * 有没有 `stopped_at IS NULL` 的行）。本函数刻意**不接收** `lastActivityAt`——
 * 一个拿不到时间戳的函数不可能按时间推断，这比「约定不要按时间推断」强。
 * 反证：`badge-transcribing-not-inferred` 用例构造「最后消息 1 秒前 + 转录已停」，
 * 断言徽标不出现。
 *
 * ## 契约缺口（已发现，**未擅自修补**）
 *
 * `chat.ThreadCard` 是 `.strict()`，`badges` 的取值域是 `MessageBadge`
 * （`degraded` | `review-pending`）。于是 uc-8-1 R7 的一等取值里，
 * **`● 转录中` 与 `已归档` 在契约的线程卡上无处安放**——F109 的 `user_visible_behavior`
 * 逐字要求这两个徽标，契约表达不了它们。
 *
 * 本文件**照实算出**这两个事实（它们是真的、来自真实状态、可断言），但**不**把它们
 * 塞进 `subtitle` 之类的自由字符串里冒充结构化字段，也**不**改契约——
 * 契约由人改（ADR-020），agent 不许改 `packages/contracts/src/**`。
 * ⇒ 缺口原样上报，见 PR 正文。`toContractBadges()` 只投影契约表达得了的那部分。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";

export type MessageBadge = z.infer<typeof C.MessageBadge>;

/** 徽标计算要用到的一条消息。刻意只有这两个字段——多给一个字段就多一种推断的可能。 */
export interface BadgeMessageFacts {
  readonly id: string;
  readonly reviewPending: boolean;
  /** 降级运行（`degraded`）。F110 才产生它；这里已经接住，免得将来在第二处补一遍。 */
  readonly degraded?: boolean;
}

/**
 * 一条消息的徽标 —— **全仓唯一的一处**。
 *
 * 列表与详情都经过它。返回数组而不是布尔：契约的 `Message.badges` / `ThreadCard.badges`
 * 都是数组，返回布尔就要在两个调用点各自组装数组，那正是第二处计算的起点。
 */
export function messageBadges(m: BadgeMessageFacts): MessageBadge[] {
  const badges: MessageBadge[] = [];
  if (m.degraded === true) badges.push("degraded");
  if (m.reviewPending) badges.push("review-pending");
  return badges;
}

/**
 * 「N 条待复核」。
 *
 * 实现是对 `messageBadges` 的计数，**不是**对 `m.reviewPending` 的计数——
 * 后者写起来更短，但它绕开了那个唯一的判定点，于是「哪些消息算待复核」又有了两个答案。
 */
export function reviewPendingCount(messages: readonly BadgeMessageFacts[]): number {
  return messages.filter((m) => messageBadges(m).includes("review-pending")).length;
}

/** 一条线程的完整徽标态。四个一等取值（uc-8-1 R7）在这里**全部**算得出来。 */
export interface ThreadBadgeState {
  /** `N 条待复核`。恒等于 `reviewPendingCount(该线程的可见消息)`。 */
  readonly reviewPending: number;
  /** `● 转录中`。恒等于「存在一个未停止的转录会话」，与消息时间无关（I-14）。 */
  readonly transcribing: boolean;
  /** `已归档`。归档线程只读、默认筛选不返回（I-15）。 */
  readonly archived: boolean;
  /**
   * `N 个 agent` 的 N。
   *
   * ⚠ 取自**该线程内发过言的不同 agent 数**，不是 AI 团队面板的在场数/编制数——
   *   那两个数属 F110（`AgentPresence`），且「在场数是否含跑批中」是
   *   `domain.md` 待裁决第 4 条，**未裁**。这里不预支那个裁决。
   * ⚠ O-24：私聊线程**不计入在场态**。本实现里私聊线程的 `agentCount` 恒为 0，
   *   且 `summary` 走 uc-8-1 R7 允许的第二种形态（`最近发言 agent · 时间`）。
   */
  readonly agentCount: number;
}

export interface ThreadBadgeInput {
  readonly messages: readonly BadgeMessageFacts[];
  /** 该线程是否有未停止的转录会话。**事实，不是推断**（I-14）。 */
  readonly transcribing: boolean;
  readonly archived: boolean;
  /** 在本线程发过言的不同 agent id。私聊线程由调用方传空——见 `agentCount` 注释。 */
  readonly speakingAgentIds: readonly string[];
}

export function threadBadgeState(input: ThreadBadgeInput): ThreadBadgeState {
  return {
    reviewPending: reviewPendingCount(input.messages),
    transcribing: input.transcribing,
    archived: input.archived,
    agentCount: new Set(input.speakingAgentIds).size,
  };
}

/**
 * 投影到契约的 `ThreadCard.badges`。
 *
 * ⚠ 只投影得出 `review-pending` 一档：`transcribing` / `archived` 在
 *   `MessageBadge` 的取值域之外（见文件头的契约缺口）。**这里不硬塞**——
 *   往 `.strict()` 的枚举里塞一个不存在的取值，`safeParse` 会在运行时拒绝，
 *   而绕过 `safeParse` 去塞就是把契约当摆设。
 */
export function toContractBadges(state: ThreadBadgeState): MessageBadge[] {
  return state.reviewPending > 0 ? ["review-pending"] : [];
}

/**
 * `ThreadCard.agentSummary` —— uc-8-1 R7「参与摘要」的两种形态之一。
 *
 * R7 逐字给了两种：`N 个 agent` **或** `最近发言 agent · 时间`。这里的选择规则是
 * 唯一的一处，且规则本身来自 O-24 而不是审美：
 *
 *   · 私聊线程（`agentPrivate`）⇒ 走第二种形态。O-24 明写「私聊**不计入**卡片上的
 *     `N 个 agent` 在场态计数」，而一个印着「1 个 agent」的私聊卡就是在计入。
 *   · 其余 ⇒ `N 个 agent`；N = 本线程内发过言的不同 agent 数（见 `agentCount`）。
 *
 * ⚠ `lastAgentLabel` 为空（没有 agent 发过言）时退化为 `最近发言 —`，不是空串：
 *   空串会在界面上与「字段没取到」无法区分。
 */
export function threadAgentSummary(input: {
  readonly state: ThreadBadgeState;
  readonly agentPrivate: boolean;
  readonly lastAgentLabel: string | null;
  readonly lastActivityLabel: string;
}): string {
  if (!input.agentPrivate) return `${input.state.agentCount} 个 agent`;
  return `${input.lastAgentLabel ?? "—"} · ${input.lastActivityLabel}`;
}
