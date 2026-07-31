/**
 * F53 -- 三层权限求交的**第①层**（`mcp-scope`）判定的纯函数部分.
 *
 * ## 这个文件不做什么
 *
 * 它不判 whitelist（第②层，F55/F58 的落点，粒度是 agent 的 `toolWhitelist`）也不判
 * 任务权限包（第③层，X-1 跨束）。`usecases.md` 与 `design-signoff.md` 都说得很清楚：
 * 完整的三层求交矩阵在 T09 验收；F53 只对**这一层**给出可验证的服务端判定，
 * 见 `feature_list.json` F53 notes 「三层求交的完整矩阵在 T09 验收」。
 *
 * ## `平台组` 判据是 [待裁]，这里不代答
 *
 * `KNOWN_CONTRACT_GAPS.AR3`（contract 顶部注释 + 行 2350 附近）逐字写着「谁算平台组」
 * 这个判据在契约里没有落点。`quarantineBlocks` 因此把 `isPlatformGroup` 当作调用方
 * 已经判定好的既成事实收进来，绝不在这个文件里猜"谁是平台组"。
 */
import type { ToolAuthScopeT } from "@repo/contracts/agent-runtime";

/** 判定 `仅项目负责人` / `仅某团队` 所需的、调用方已经解析好的身份事实。 */
export interface ActorMcpContext {
  readonly isProjectOwner: boolean;
  readonly isInAuthorizedTeam: boolean;
}

export interface ScopeEvaluation {
  readonly allowed: boolean;
  /** `需人工确认每次`：允许，但调用方必须为这次调用生成 `confirmationId`（F130，非本文件职责）。 */
  readonly requiresConfirmation: boolean;
}

/**
 * 授权范围（服务器级或工具级，形状相同）对某个 actor 的判定。
 *
 * ⚠ **纯函数、无 I/O**——谁是「项目负责人」/「该团队成员」是调用方（application 层）
 *   查完再传进来的事实，不在这里查。
 */
export function evaluateMcpAuthScope(
  scope: ToolAuthScopeT,
  actor: ActorMcpContext,
): ScopeEvaluation {
  switch (scope) {
    case "全体成员":
      return { allowed: true, requiresConfirmation: false };
    case "仅某团队":
      return { allowed: actor.isInAuthorizedTeam, requiresConfirmation: false };
    case "仅项目负责人":
      return { allowed: actor.isProjectOwner, requiresConfirmation: false };
    case "需人工确认每次":
      return { allowed: true, requiresConfirmation: true };
    case "未开放":
      return { allowed: false, requiresConfirmation: false };
  }
}

/**
 * 🔴 F131 · I-30′：隔离期内、非平台组身份的调用被拒。
 *
 * ⚠ `quarantineUntil === null` 恒放行——它是「非第三方源 / 未进入隔离期」的记法（contract
 *   行 578 附近），不是"隔离期已经过去"的记法，两者不可合并，否则一个刚过期未复核的服务器
 *   会被误判为"从未隔离过"。过期但未复核走的是 `reviewStatus === 已到期待复核`，不在本函数管。
 * ⚠ 平台组身份 **不放宽任何其它层**——它只越过隔离期这一条闸门，其余判定（含 authScope）
 *   照常跑，这正是下面 `authorizeMcpScopeLayer1` 把两条判定分开调用、而不是"平台组直接放行"
 *   的原因。
 */
export function quarantineBlocks(input: {
  readonly quarantineUntil: string | null;
  readonly now: Date;
  readonly isPlatformGroup: boolean;
}): boolean {
  if (input.quarantineUntil === null) return false;
  if (input.isPlatformGroup) return false;
  return input.now.getTime() < new Date(input.quarantineUntil).getTime();
}
