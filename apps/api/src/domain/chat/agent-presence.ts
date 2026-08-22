/**
 * AI 团队面板的在场态 —— **唯一一处计算**（chat 束 domain.md I-17 / I-18，uc-8-2 UC-7）。
 *
 * ## I-18：两个计数分开，且只有一处算得出来
 *
 * `presentCount`（在场）与 `rosterCount`（编制）是两回事——F109 徽标的教训（同一份
 * `contract-design.md` 反复举的例子：设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA /
 * 估点）已经踩过五次「同一事实声明在两处」。这里取跟 `thread-badges.ts` 一样的做法：
 * 不写两个各自的 SQL/JS 求和，而是让两个数都是对**同一份 agent 列表**的两次不同投影
 * （`presentCount` 是过滤后计数，`rosterCount` 是恒等计数），调用点拿到的是
 * `agentPanelCounts()` 的返回值，不是分别调两个函数各自求一次。
 *
 * ⚠ 「在场是否含跑批中」是待裁决（domain.md 待裁决第 4 条）。**本文件不预支那个裁决**：
 *   契约 `chat.AgentPresence` 是三值 `present`/`away`/`off`（不含"跑批中"），
 *   这里就按契约字面算——只有 `present` 算在场。若人类裁决后契约改了取值，
 *   这里的 `=== "present"` 判断随之改，但仍然是**这一处**改，不是两处各改一次。
 *
 * ## I-17：每个 agent 必须有非空 duty
 *
 * 「一个说不出职责的 agent 在面板里等于噪音」——`assertAgentPanelInvariants` 是
 * 这条不变量唯一的断言点。它抛错而不是静默补一个占位字符串：数据本不该长成这样，
 * 让它安静地变成"（无职责）"只会把这个问题从"看得见的 500"变成"看不见的界面缺陷"。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";

/** 三值封闭，与契约 `chat.AgentPresence` 同码同义，不另起一份枚举。 */
export type AgentPresenceValue = z.infer<typeof C.AgentPresence>;

/** 面板/编制里的一个 agent。`duty`/`roleLabel` 非空是 I-17 的前提，见下方断言函数。 */
export interface AgentPanelAgent {
  readonly id: string;
  readonly abbr: string;
  readonly name: string;
  readonly duty: string;
  /** #1705（#728 D-1）—— 简短角色头衔，D2/D5 展示用。与 `duty` 是两个不同的展示位。 */
  readonly roleLabel: string;
  readonly presence: AgentPresenceValue;
}

export class AgentDutyEmptyError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent_duty_empty:${agentId}`);
  }
}

/** #1705——同 `AgentDutyEmptyError`，`roleLabel` 版本，不复用同一个错误类型（字段不同）。 */
export class AgentRoleLabelEmptyError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent_role_label_empty:${agentId}`);
  }
}

/**
 * I-17 的唯一断言点。**在把 agent 列表交给调用方之前调用**——
 * 断言写在读路径的末端，晚了就等于允许一个空 duty/roleLabel 的 agent 先被用掉。
 */
export function assertAgentPanelInvariants(agents: readonly AgentPanelAgent[]): void {
  for (const a of agents) {
    if (a.duty.trim().length === 0) throw new AgentDutyEmptyError(a.id);
    if (a.roleLabel.trim().length === 0) throw new AgentRoleLabelEmptyError(a.id);
  }
}

/** I-18 的两个计数。**这是全仓唯一算它们的地方**——调用点不得各自再数一遍。 */
export interface AgentPanelCounts {
  readonly presentCount: number;
  readonly rosterCount: number;
}

export function agentPanelCounts(agents: readonly AgentPanelAgent[]): AgentPanelCounts {
  return {
    presentCount: agents.filter((a) => a.presence === "present").length,
    rosterCount: agents.length,
  };
}
