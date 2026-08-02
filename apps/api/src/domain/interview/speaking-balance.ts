/**
 * F91 —— 发言时长监测与私下提醒 (`uc-6-4` R3 步骤4, E2, V5;
 * `packages/contracts/src/interview.ts` `evaluateSpeakingBalance`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的不变量：两个信号缺一不可
 *
 * 原型原文「Weber 已连续发言 4 分 20 秒，Kraus 在当前主题尚未回答且已举手」——注意这句话
 * 本身就是两个事实的合取，不是一个事实的强调。issue notes 逐字：「触发需同时满足连续时长
 * （默认 240 秒可配）与他人举手/未答两信号，不能只看时长」。一个只看时长的实现会在受访者
 * 正常做长叙述时反复打断研究员的注意力——这正是后台反馈「FC Facilitator·打断时机过早
 * 👎9」的教训（O-36 明确要求不复制这个错误）。所以 `evaluateSpeakingBalance` 在
 * 时长达标但没有任何人举手/未答时必须返回 `null`，这条比"时长达标就提醒"更重要。
 *
 * ## 为什么"私下"是这个函数的返回值本身回答的问题，不是调用方多加一层判断
 *
 * R5 原文「私下＝只在研究员这一栏出现，不广播、不对受访者可见」。本函数不接受任何广播
 * 目标参数、不产生任何面向受访者的输出——它的唯一输出形状就是契约 `evaluateSpeakingBalance.
 * out.alert`（研究员端点的响应体），调用方没有第二条路径可以把这个结果转发给受访者或广播
 * 通道，因为这个结果压根不知道"受访者端"是什么。
 *
 * ## 本文件刻意没有的东西
 * · **如何持续追踪"连续发言秒数"**（谁在说话、说了多久）——那是编排层订阅转录流水线的
 *   事，本文件只管"给定当前这一时刻的快照，要不要提醒"。
 * · **`[邀请 X]` 一键出口的执行**——那是 `inviteSpeaker` 用例（契约已定义），本文件只产出
 *   `pendingSpeakerId` 让调用方拿去调那个用例，不在这里发起邀请。
 */
import { thresholds as TH } from "@repo/contracts";

/** 举手/待答队列里的一位候选者。 */
export interface WaitingParticipant {
  readonly subjectId: string;
  readonly displayName: string;
  readonly handRaised: boolean;
  /** 在**当前主题**下是否已经答过——不是"整场是否发过言"。 */
  readonly hasAnsweredCurrentTopic: boolean;
}

export interface SpeakingBalanceSnapshot {
  readonly activeSpeakerName: string;
  /** 当前发言人连续发言的秒数（同一人未被打断地持续说话）。 */
  readonly continuousSeconds: number;
  /** 触发阈值，项目级可配置；默认取 `THRESHOLDS.speakingBalanceThresholdSeconds`（O-36）。 */
  readonly thresholdSeconds: number;
  /** 按举手先后排列；函数只取第一个同时满足「举手 且 当前主题未答」的人。 */
  readonly waitingParticipants: readonly WaitingParticipant[];
}

/** 与契约 `evaluateSpeakingBalance.out.alert` 逐字段对齐——不在这里另造一份形状。 */
export interface SpeakingBalanceAlert {
  readonly continuousSeconds: number;
  readonly pendingSpeakerId: string;
  readonly text: string;
}

/**
 * O-36 已裁决的默认值。**不得在别处另抄字面量 `240`。**
 * 项目若配置了自己的阈值，调用方应传入那个值而不是本常量。
 */
export const DEFAULT_SPEAKING_BALANCE_THRESHOLD_SECONDS: number = TH.requireValue<number>(
  TH.THRESHOLDS.speakingBalanceThresholdSeconds,
  "speakingBalanceThresholdSeconds",
);

function formatDurationLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
}

/**
 * evaluateSpeakingBalance —— 双信号判定（uc-6-4 R3 步骤4）。
 *
 * ⚠ 只看 `continuousSeconds`：即使远超阈值，若没有任何人「举手且当前主题未答」，
 *   返回 `null`——这是本文件的核心反证目标，见文件头注释。
 * ⚠ 只有人举手/未答、但时长未达阈值：同样返回 `null`——两个信号必须**同时**为真。
 */
export function evaluateSpeakingBalance(input: SpeakingBalanceSnapshot): SpeakingBalanceAlert | null {
  if (input.continuousSeconds < input.thresholdSeconds) return null;

  const pending = input.waitingParticipants.find((p) => p.handRaised && !p.hasAnsweredCurrentTopic);
  if (pending === undefined) return null;

  return {
    continuousSeconds: input.continuousSeconds,
    pendingSpeakerId: pending.subjectId,
    text:
      `${input.activeSpeakerName} 已连续发言 ${formatDurationLabel(input.continuousSeconds)}，` +
      `${pending.displayName} 在当前主题尚未回答且已举手。`,
  };
}
