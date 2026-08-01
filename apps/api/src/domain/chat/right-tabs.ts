/**
 * 右栏五标签计数 —— **唯一一处计算**（chat 束 domain.md，uc-8-2 UC-11 / R7 / V9 / V14）。
 *
 * ## 为什么是「恒五个」而不是「有内容才出现」
 *
 * 契约 `chat.RightTab` 是五值封闭枚举（`transcript`/`execution`/`insight`/`artifact`/
 * `material`），`getRightTabs.out.tabs` 的形状逐字要求**恒五个**——V14 明写「计数全为 0
 * 且不隐藏标签」。把「没有内容」处理成「不返回这个标签」会让界面在空态与依赖失败之间
 * 无法区分（两者现在都表现为「看不到这个标签」）。所以这里的输出永远是长度为 5 的数组，
 * 顺序固定为契约枚举的声明顺序，调用方不需要（也不应该）自己拼数组。
 *
 * ## `hidden` 与 `failed` 是两个独立维度，别合并
 *
 * - `hidden`：**业务规则**使这个标签在当前语境下不适用——目前唯一的规则是 E1
 *   「研究阶段不显示现场转录」，`phase === "research"` 时 `transcript` 标 `hidden`。
 *   隐藏不等于失败：数据是好的，只是这个阶段不该看。
 * - `failed`：**该标签自己的数据源不可用**（uc-8-2 UC-11 `err` 注释「各标签独立的依赖
 *   失败，不整体失败」）。一个标签失败不得连累其余四个——所以这里按标签逐个接收
 *   `failed` 事实，而不是整个函数在任一数据源失败时抛错。
 *
 * ## 计数与列表长度一致（V9）是调用方的责任，不是本文件重新求和
 *
 * 与 `thread-badges.ts` / `agent-presence.ts` 同一个纪律：本文件**不重新数**任何列表，
 * 只接收调用方已经数好的整数（`RightTabCounts`），原样投影成契约形状。若两处出现不同的
 * 数字，问题在调用方传错了输入，不在这里——把「数」和「投影成五个标签」分开，
 * 是不给「第二处求和」留下生长的地方。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";

export type RightTabKey = z.infer<typeof C.RightTab>;

/** 五个标签固定顺序——与契约 `RightTab` 枚举声明顺序逐字一致。 */
export const RIGHT_TAB_ORDER: readonly RightTabKey[] = [
  "transcript", "execution", "insight", "artifact", "material",
];

/** 调用方已经数好的、每个标签各自的计数。 */
export interface RightTabCounts {
  readonly transcript: number;
  readonly execution: number;
  readonly insight: number;
  readonly artifact: number;
  readonly material: number;
}

/** 每个标签各自的依赖失败态。缺省为 `false`（假定这些数据源都取到了）。 */
export interface RightTabFailures {
  readonly transcript?: boolean;
  readonly execution?: boolean;
  readonly insight?: boolean;
  readonly artifact?: boolean;
  readonly material?: boolean;
}

export interface RightTabsInput {
  readonly counts: RightTabCounts;
  readonly failures?: RightTabFailures;
  /** E1：研究阶段不显示现场转录。 */
  readonly phase: "onsite" | "research";
}

export interface RightTabView {
  readonly tab: RightTabKey;
  readonly count: number;
  readonly failed: boolean;
  readonly hidden: boolean;
}

/**
 * 计算右栏五标签。**恒返回长度为 5 的数组**，顺序固定，任何调用点都不需要
 * （也不应该）再自己拼数组或过滤某个标签。
 */
export function computeRightTabs(input: RightTabsInput): readonly RightTabView[] {
  const failures = input.failures ?? {};
  return RIGHT_TAB_ORDER.map((tab) => ({
    tab,
    count: input.counts[tab],
    failed: failures[tab] ?? false,
    // 目前唯一的隐藏规则是 E1；写成显式的 tab === "transcript" 判断而不是一张
    // 「隐藏规则表」，是因为**只有这一条规则**——为一条规则建一张表本身就是过度设计,
    // 等第二条隐藏规则出现时再抽取共同形状。
    hidden: tab === "transcript" && input.phase === "research",
  }));
}
