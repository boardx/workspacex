/**
 * F58 -- 改派路由（建议，非自动执行）：判据是**三层权限求交后的授权集**（复用 F56
 * `intersectAgentPermission`），理由必须写出**具体授权名**，改派须人点 `[改派]` 确认。
 *
 * `user_visible_behavior`: 「对话输入区上方出现改派提示"这条更适合 Scout：它有行业数据库
 * 授权"，理由写出具体授权名，改派必须人点 [改派]、[×] 可忽略；把行业数据库 MCP 置为已隔离后
 * 该建议不再出现」。
 *
 * ## Why this calls `intersectAgentPermission` instead of comparing whitelist entries directly
 *
 * "改派" 的判据不是"候选 agent 的白名单里有这个工具"这么简单 —— 一个候选即使白名单命中，
 * 若它自己的 MCP 授权范围（层①）或任务权限包（层③）不放行，改派过去也一样会被拒。判据必须是
 * **三层求交后的最终允许**，否则会出现"改派了但候选照样调用失败"的假建议。复用 F56 的合并点
 * 而不是本模块另起一套判定，正是 AGENTS.md 的单一事实源纪律。
 *
 * ## Why the current agent is checked first, and only a DENIED current agent triggers a suggestion
 *
 * R9 的隐含前提：改派是"帮当前 agent 做不到的事换一个能做的"，不是"随时把活动改派给权限更宽的
 * agent"。若当前 agent 本就三层全放行，提前返回"无建议"，即使某个候选也放行——否则每条消息都会
 * 弹改派条，与"改派提示不常驻、只在真正需要时出现"的用户可见行为矛盾。
 *
 * ## Why the suggestion carries only `reasonAuthorityName`, not the whitelist entry itself
 *
 * R9 明写"不得泄露当前用户无权知晓的授权信息"——只说"它有行业数据库授权"，不列出具体工具全名
 * 或凭据。调用方传入的 `authorityLabel` 就是这个人类可读的边界；本模块的返回类型里没有任何字段
 * 能装下 `toolFullName` 或凭据，从类型层面堵掉"顺手把内部字段透出去"的实现。
 */
import {
  intersectAgentPermission,
  type ThreeLayerInput,
} from "./three-layer-permission";

/** 一个候选改派对象：它对"这次调用"的三层权限事实 + 对外可说的授权名。 */
export interface RedispatchCandidate {
  readonly agentId: string;
  /** 该候选对同一次调用的三层权限事实（同一 `ThreeLayerInput` 形状，复用 F56 的合并点）。 */
  readonly permission: ThreeLayerInput;
  /** 人类可读、可对外说的授权名，例如「行业数据库授权」——不是工具全名，不是凭据。 */
  readonly authorityLabel: string;
}

export interface RedispatchInput {
  /** 当前 agent 对本次调用的三层权限事实。 */
  readonly currentPermission: ThreeLayerInput;
  /** 候选改派对象，按呈现优先级排列；取第一个三层全放行的。 */
  readonly candidates: readonly RedispatchCandidate[];
}

export interface RedispatchSuggestion {
  /** `null` = 无建议（正常空态，不是失败）。 */
  readonly suggestedAgentId: string | null;
  /** 具体授权名；`null` 当且仅当无建议。 */
  readonly reasonAuthorityName: string | null;
}

/**
 * `suggestRedispatch` 的领域核心：当前 agent 三层求交若已放行 ⇒ 无建议；否则找**第一个**
 * 三层求交放行的候选，建议改派给它，理由取该候选登记的 `authorityLabel`。
 *
 * ⚠ 找不到任何三层全放行的候选（例如唯一的候选也被隔离/撤销授权）⇒ 无建议，
 * **不回退到"随便建议一个"**——这正是"行业数据库 MCP 置为已隔离后该建议不再出现"的机制：
 * 隔离改变的是候选的 `permission.whitelistEntry`（或 layer1），使其三层求交转为拒绝，
 * 本函数据此自然不再命中它，不需要额外的"已隔离"特判分支。
 */
export function suggestRedispatch(input: RedispatchInput): RedispatchSuggestion {
  const currentResult = intersectAgentPermission(input.currentPermission);
  if (currentResult.allowed) {
    return { suggestedAgentId: null, reasonAuthorityName: null };
  }

  for (const candidate of input.candidates) {
    const result = intersectAgentPermission(candidate.permission);
    if (result.allowed) {
      return {
        suggestedAgentId: candidate.agentId,
        reasonAuthorityName: candidate.authorityLabel,
      };
    }
  }

  return { suggestedAgentId: null, reasonAuthorityName: null };
}

export interface ApplyRedispatchInput {
  /** 人点了 `[改派]` = true；点 `[×]` 忽略或未操作 = false。**不是本模块推断出来的**。 */
  readonly accept: boolean;
  /** 本轮 `suggestRedispatch` 给出的建议对象；`null` 表示当时就没有建议可接受。 */
  readonly suggestedAgentId: string | null;
}

export interface ApplyRedispatchResult {
  readonly applied: boolean;
  readonly newAgentId: string | null;
}

/**
 * 改派是**建议**，不是自动执行（issue 原话）：只有 `accept === true` 且存在建议对象时才
 * "应用"。`accept: false`（用户点 `[×]`）或建议已经是 `null`（例如用户思考期间条件已变化）
 * 一律不应用 —— 人没点确认，什么都不该发生，这正是"必须人点 [改派]"的字面意思。
 */
export function applyRedispatch(input: ApplyRedispatchInput): ApplyRedispatchResult {
  if (!input.accept || input.suggestedAgentId === null) {
    return { applied: false, newAgentId: null };
  }
  return { applied: true, newAgentId: input.suggestedAgentId };
}
