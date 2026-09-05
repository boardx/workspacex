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
 *
 * ⚠ **上面那条「agent 不许改契约」在本次改动里被合法地跨过了一次，如实记录**：
 *   issue #2094 改了 `ThreadCard`（删 `agentSummary`，加 `status` + `artifactCount`）。
 *   依据是人类 2026-08-26 的**明示裁决**，且裁决本身即签核动作
 *   （`design-signoff.md` S-06 那条待裁决项由它了结）。这**不是**先例：
 *   没有人类逐条裁决时，这条禁令照旧。
 */
import { chat as C, wave2Runtime as W } from "@repo/contracts";
import type { z } from "zod";

export type MessageBadge = z.infer<typeof C.MessageBadge>;
/** 🔴 #2094：线程卡状态的取值域**引用契约**，不在这里另抄一份字面量联合。 */
export type ThreadCardStatus = z.infer<typeof C.ThreadCardStatus>;
/**
 * 🔴 #2094：最近一次 run 的状态。**引用 `AgentRunStatus` 契约**——
 * 在这里抄一份 `"queued" | "running" | ...` 就是「同一事实声明在两处」，
 * 而漂移的那天（有人往 `agent_runs.status` 的 CHECK 里加了第六个值）不会有人收到通知。
 * 现在那一天会变成 `threadCardStatus()` 里 `never` 那一行的编译错。
 */
export type AgentRunStatusFact = z.infer<typeof W.AgentRunStatus>;

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
}

/**
 * 🔴 #2094：`agentCount` / `speakingAgentIds` 已删除，不是改名。
 *
 * 它们**唯一的消费者**是已删除的 `threadAgentSummary()`。留着一个没人读的计数，
 * 下一个人会以为它是权威并在第二处消费它——本仓「同一事实声明在两处」的标准起手式。
 * 连带 `findSpeakingAgentIds` 的每线程一次查询也一并省掉（列表页 N 条线程少 N 次查询）。
 */
export interface ThreadBadgeInput {
  readonly messages: readonly BadgeMessageFacts[];
  /** 该线程是否有未停止的转录会话。**事实，不是推断**（I-14）。 */
  readonly transcribing: boolean;
  readonly archived: boolean;
}

export function threadBadgeState(input: ThreadBadgeInput): ThreadBadgeState {
  return {
    reviewPending: reviewPendingCount(input.messages),
    transcribing: input.transcribing,
    archived: input.archived,
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
 * `ThreadCard.status` —— **唯一的一处判定**（🔴 issue #2094，人类裁决落地，回指 #2068）。
 *
 * ## 它取代了什么，以及为什么
 *
 * 这里此前是 `threadAgentSummary()`，返回 `` `${agentCount} 个 agent` ``。
 * 三件事同时成立，所以它必须走：
 *
 *   ① **人类审计点名**（2026-08-26，看自己的 `/chat` 截图）：
 *      「对话列表不可辨认——大量『新对话』，只显示 `0 个 agent`，无法寻找历史任务」。
 *      活体实测逐字复现：侧栏连续三条「新对话 0 个 agent · 01:14」。
 *   ② **它连自己名义上那个意思都没准确表达**：`agentCount` 数的是**已发过言的**
 *      agent（旧的 `speakingAgentIds`，已随本次改动一并删除），不是编制成员——于是一条刚建好、
 *      编制里明明有 agent 的线程恒显示 `0 个 agent`。
 *   ③ **它从来没被签核过**。`design-signoff.md` 的 S-06 至今是未勾选的 `[ ]`：
 *      「『在场 4 / 编制 6』…它同时决定线程卡上的『N 个 agent』是哪个数——UC 没写」，
 *      `domain.md` I-18 亦自述「裁决后可能要改」。本函数即那条裁决的落地。
 *
 * ## 五个取值都从**事实**算，不从推断算
 *
 * 与 I-14（`● 转录中` 不许按时间推断）同一条纪律：本函数**不接收** `lastActivityAt`，
 * 也不接收任何时间戳——一个拿不到时间的函数不可能按「多久没动了」猜状态。
 * 它只接收两个真实事实：这条线程有没有消息、最近一次 run 的 `status` 是什么。
 *
 *   · 没有消息            ⇒ `not-started`（devapp 实测 58 条线程 36 条如此。
 *                            这不是「已完成」，把它显示成已完成就是撒谎）
 *   · 有消息、没有 run     ⇒ `done`（消息已落地，没有在跑的东西）
 *   · 最近 run `queued` / `running` / `writeback_pending` ⇒ `running`
 *   · 最近 run `awaiting_tool_permission` ⇒ `awaiting-approval`
 *   · 最近 run `failed`    ⇒ `failed`
 *   · 最近 run `succeeded` ⇒ `done`
 *
 * ⚠ **返回领域枚举，不返回中文串**。返回串会把「状态是什么」和「状态叫什么」
 *   焊死在一处，而那正是 `0 个 agent` 当年的形状：文案漂在自由字符串里，
 *   没有任何门控看得见它。文案映射的唯一一处在 web 侧的 `THREAD_STATUS_LABEL`。
 */
export function threadCardStatus(input: {
  /** 该线程有没有任何可见消息。 */
  readonly hasMessages: boolean;
  /** 该线程最近一次 `agent_runs` 的 status；从来没跑过则为 `null`。 */
  readonly latestRunStatus: AgentRunStatusFact | null;
}): ThreadCardStatus {
  if (!input.hasMessages) return "not-started";
  switch (input.latestRunStatus) {
    case "queued":
    case "running":
    case "writeback_pending":
      return "running";
    case "awaiting_tool_permission":
      return "awaiting-approval";
    case "failed":
      return "failed";
    case "succeeded":
    case null:
    case undefined:
      return "done";
    default: {
      // 枚举被加了新取值却没在这里处理时，这一行是编译期的红。
      const exhaustive: never = input.latestRunStatus;
      return exhaustive;
    }
  }
}
