/**
 * F216（`agent-interrupts` 契约束）—— 中断决策统一守卫：`usecases.md` 顶部
 * `AgentInterruptError` 8 错误码，fail-closed（横切三张卡共享，不在 F213/F214/F215
 * 各自实现一遍——`usecases.md` 顶部原文「三个 UC 共享的失败枚举见下」）。
 *
 * ## 范围边界——与既有通用 HITL 通路的关系
 *
 * `apps/api/src/application/agent-run/decide-agent-run.ts` 已经是 `call_skill` 与
 * 本束三种新中断**共用**的裁决出口，且已经承担了 `NOT_VISIBLE`（`AgentRunNotVisibleError`）
 * /`NO_WRITE_ROLE`（`AgentRunRetryForbiddenError`）/"当前不在待批态"
 * （`AgentRunNotAwaitingToolPermissionError`）三类判定——但用的是那条通路**自己的**错误类型，
 * 不是本束契约里的字符串码（两者语义相邻但字面不同，逐字改名会影响 `call_skill` 既有
 * 行为，不在本 issue 单方面做）。
 *
 * 本文件补的是**本束独有、`call_skill` 通路不需要因而没有的那几类**判定——
 * `INTERRUPT_KIND_MISMATCH`（decision 载荷形状与当前 pending 中断的 kind 不符，
 * `call_skill` 只有一种 kind，这类错配无从谈起）、`MALFORMED_RESUME_PAYLOAD`
 * （既不是已知字面量也不是合法 JSON）、`SELECTED_OPTION_NOT_FOUND`
 * （`choose_option` 专属，见 `choose-option-decision.ts`）——并把**全部 8 码**
 * 汇总成一个纯函数、单一判定顺序、fail-closed（任何未覆盖的组合落进最保守的可用码，
 * 不放行），供调用方（真正接入 HTTP 层时）按同一顺序检查，不必在三张卡各自重新
 * 排一遍判定优先级。
 *
 * ## 判定顺序——为什么这样排（fail-closed 的含义之一：先查最根本的，再查更具体的）
 *
 * 1. `NOT_VISIBLE`——看不见这个线程，后面的一切判定都没有意义。
 * 2. `NO_WRITE_ROLE`——看得见但没有写权（观察者恒无写权）。
 * 3. `NO_ACTIVE_INTERRUPT`——这个线程当前没有本束任一 kind 的 pending 中断
 *    （不区分"从来没有"还是"已经被解决"——那是下一步 `STALE_INTERRUPT` 才细分的事）。
 * 4. `MALFORMED_RESUME_PAYLOAD`——载荷本身解析不出来，不用往下比对 kind。
 * 5. `INTERRUPT_KIND_MISMATCH`——载荷能解析，但暗示的 kind 与当前 pending 中断的
 *    kind 不符（例如对 confirm_intent 发 choose_option 形状）。
 * 6. `STALE_INTERRUPT`——`requestId` 对不上当前 pending 中断（已被另一个决策解决，
 *    并发场景）。
 * 7. `SELECTED_OPTION_NOT_FOUND`——仅 `choose_option` 的 `edit` 分支适用。
 * 8. `AUDIT_SINK_UNAVAILABLE`——前面全部通过，决策本该生效，但审计写不进 ⇒
 *    整个 resume 失败，fail closed（与 `agent-runtime` 束 `ProvenanceWriter`
 *    同一纪律：宁可让请求失败，也不留一条没有审计痕迹的决策）。
 *    ⚠ 因此它排在**最后**——只有前面全部判定通过、决策本来会生效时才检查它，
 *    不能提前到最前面（提前会让审计不可用时连"这条决策形状对不对"都判断不出来，
 *    白白掩盖真正的错误原因）。
 * 全部通过 ⇒ 返回 `null`（可以放行）。
 */
import type { AgentInterruptError, AgentInterruptKind } from "@repo/contracts/agent-interrupts";

export interface PendingInterrupt {
  readonly kind: AgentInterruptKind;
  readonly requestId: string;
}

/**
 * 已解析出的 resume 载荷——`null` 表示"载荷既不是已知字面量也不是合法 JSON"
 * （对应 `MALFORMED_RESUME_PAYLOAD`，同 `parseHitlDecision` 的既有三态解析纪律，
 * 见 `domain.md` 缺口 AI-2）。`requestId` 缺省时视为"未声明要对哪个中断决策"，
 * 与当前 pending 中断的 `requestId` 比对走 `STALE_INTERRUPT`。
 */
export type ParsedResumePayload =
  | null
  | {
      readonly impliedKind: AgentInterruptKind;
      readonly requestId: string | null;
      /** 仅 `choose_option` 的 `edit` 分支需要——是否命中原始 options 集合，由
       *  `choose-option-decision.ts` 的 `resolveChooseOptionDecision` 判定后传入；
       *  非 `choose_option` 或非 `edit` 分支恒为 `null`（不适用）。 */
      readonly selectedOptionFound: boolean | null;
    };

export interface DecisionGuardInput {
  readonly visible: boolean;
  readonly canWrite: boolean;
  readonly pendingInterrupt: PendingInterrupt | null;
  readonly payload: ParsedResumePayload;
  readonly auditWritable: boolean;
}

/** fail-closed：8 码任一命中即返回对应码；全部通过才返回 `null`（放行）。 */
export function guardAgentInterruptDecision(input: DecisionGuardInput): AgentInterruptError | null {
  if (!input.visible) return "NOT_VISIBLE";
  if (!input.canWrite) return "NO_WRITE_ROLE";
  if (input.pendingInterrupt === null) return "NO_ACTIVE_INTERRUPT";
  if (input.payload === null) return "MALFORMED_RESUME_PAYLOAD";
  if (input.payload.impliedKind !== input.pendingInterrupt.kind) return "INTERRUPT_KIND_MISMATCH";
  if (input.payload.requestId !== null && input.payload.requestId !== input.pendingInterrupt.requestId) {
    return "STALE_INTERRUPT";
  }
  if (input.payload.selectedOptionFound === false) return "SELECTED_OPTION_NOT_FOUND";
  if (!input.auditWritable) return "AUDIT_SINK_UNAVAILABLE";
  return null;
}
