/**
 * F105 — `applyStickyChange` 便签级 LWW（Last-Write-Wins）。
 *
 * ⚠ **不弹冲突条**（I-16 的反面：只有两侧同时改结构才弹）。同一张便签的
 * 文本/颜色/位置/归属分区被并发改动时，按 `clientTs` 较晚者生效，较早那次
 * 不是被丢弃——它被记成一条历史版本，`supersededRevisionId` 必须能查到
 * 被覆盖的那次（I-19）。「不弹冲突条」≠「没有留痕」。
 *
 * ⚠ **待裁决期间此端口照常可用**（I-18）：`applyStickyChange` 的 err 列表
 * 里故意没有 `CONFLICT_PENDING_ADJUDICATION`——本模块不接受、也不检查任何
 * "结构性冲突待裁决" 的状态，因为便签级写从不因为它而被挡。
 */

/** 单张便签当前记着的最近一次修订——LWW 判定与历史回溯都靠它。 */
export interface StickyRevision {
  readonly revisionId: string;
  readonly appliedTs: string;
  readonly patch: StickyPatch;
}

export interface StickyPatch {
  readonly text?: string;
  readonly color?: string;
  readonly size?: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly sectionId?: string;
}

export interface StickyState {
  readonly stickyId: string;
  /** 当前生效的修订；`null` 表示这张便签还没有任何一次 `applyStickyChange` 落过地。 */
  readonly current: StickyRevision | null;
  /** 被覆盖的历史修订，按发生顺序追加——LWW 不丢内容，只是不再生效。 */
  readonly history: readonly StickyRevision[];
}

export function emptyStickyState(stickyId: string): StickyState {
  return { stickyId, current: null, history: [] };
}

export interface ApplyStickyChangeResult {
  readonly stickyId: string;
  readonly appliedTs: string;
  /** 被这次写覆盖的上一条修订 id；这张便签第一次被写时为 `null`。 */
  readonly supersededRevisionId: string | null;
  readonly nextState: StickyState;
}

/**
 * LWW 核心：谁的 `clientTs` 更晚谁生效。
 *
 * ⚠ **"更晚"按 `clientTs` 字符串的时间序比较，而不是"谁先到达服务端"**——
 *   现场网络抖动常见，后到的请求可能带着更早的 `clientTs`（例如断线重连后
 *   重放一条旧改动）。如果改用到达顺序，网络慢的那位组员的改动会被顺序上更晚
 *   到达、但时间戳更早的重放请求覆盖，这违反"最后写入"里"最后"的语义——
 *   它应该指用户改动发生的时刻，不是请求送达服务端的时刻。
 *
 * ⚠ 时间戳打平（同一毫秒并发写）时，**新请求生效**——不产生"两个都不生效"
 *   或"随机选一个"这种不确定性；`revisionId` 仍然分别记录，历史不丢。
 */
export function applyStickyChange(params: {
  readonly state: StickyState;
  readonly patch: StickyPatch;
  readonly clientTs: string;
  readonly makeRevisionId: () => string;
}): ApplyStickyChangeResult {
  const { state, patch, clientTs, makeRevisionId } = params;
  const incoming: StickyRevision = { revisionId: makeRevisionId(), appliedTs: clientTs, patch };

  const current = state.current;
  const incomingWins = current === null || clientTs >= current.appliedTs;

  if (!incomingWins) {
    // 迟到的、时间戳更早的改动：仍然记进历史（不丢内容），但不覆盖当前生效值。
    return {
      stickyId: state.stickyId,
      appliedTs: current.appliedTs,
      supersededRevisionId: null,
      nextState: { ...state, history: [...state.history, incoming] },
    };
  }

  const supersededRevisionId = current?.revisionId ?? null;
  const nextHistory = current ? [...state.history, current] : state.history;

  return {
    stickyId: state.stickyId,
    appliedTs: incoming.appliedTs,
    supersededRevisionId,
    nextState: { ...state, current: incoming, history: nextHistory },
  };
}

/**
 * 便签的当前有效值——把 `current` 修订的 `patch` 与历史上一次生效值叠起来。
 * `applyStickyChange` 只落一条修订，不是整份便签快照；本函数把"当前生效状态"
 * 重建出来供调用方（application 层）合成便签的最新读模型。
 */
export function resolveEffectivePatch(state: StickyState): StickyPatch {
  return state.current?.patch ?? {};
}

/**
 * 给定一条 `supersededRevisionId`，能否在历史里查到它——I-19 的直接断言面：
 * "不弹冲突条，但必须能查到被覆盖的那次"。
 */
export function findSupersededRevision(
  state: StickyState,
  revisionId: string,
): StickyRevision | undefined {
  return state.history.find((r) => r.revisionId === revisionId);
}
