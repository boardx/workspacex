/**
 * Issue #4363（S6）—— 长期记忆的**链式**取代历史（211 → 985 → 清华），纯函数部分。
 *
 * R9（#4302）只折叠一层：被取代的旧记忆挂在「取代它的那条**活**记忆」下面。链上第二次改口之后，中间那条（985）自己也被
 * 取代了——211 找不到活的挂靠点，从大脑页上消失。这里把每条被取代的记忆沿「谁取代了它」一路走到链尾那条活记忆，
 * 按离它几步（step）排好：step 1 = 直接被它取代，step 2 = 被「取代了它的那条」再取代……
 *
 * 撤销与 R9 一致：只有 step 1 的那一环可能给撤销（撤销更早的一环，得先把后面那一环撤掉——那时它又成了 step 1）。
 * 链里有环、断了（中间那条被忘掉 / 撤回，不是被取代）、或走得太深 ⇒ 这一条不显示（「撤销的不显示」，#4302 人类决定）。
 */

/** 一条被取代的旧记忆与直接取代它的那一条（后者可能还活着，也可能自己又被取代了）。 */
export interface ReplacedLink {
  readonly oldClaimId: string;
  readonly oldStatement: string;
  /** 直接取代它的那条（查看者个人空间里的）。 */
  readonly successorId: string;
  /** 撤销这一次取代的入口（R9 的规则在读口判好：提示所在对话是本人的个人对话、新决定还活着）。 */
  readonly undo: { readonly threadId: string; readonly noticeId: string } | null;
}

export interface ChainedReplaced {
  readonly byClaimId: string;
  readonly replaces: { readonly claimId: string; readonly statement: string };
  readonly undo: { readonly threadId: string; readonly noticeId: string } | null;
  /** 只在 step ≥ 2 时出现（step 1 省略，契约 KgPersonalReplacedClaim 注释：省略 = 1）。 */
  readonly step?: number;
  readonly replacedBy?: { readonly claimId: string; readonly statement: string };
}

/** 链最多走多深：再长的改口历史也不该在一条记忆下面摊出一整页。 */
export const SUPERSEDE_CHAIN_MAX_STEPS = 20;

/**
 * `links`：查看者个人空间里全部被取代的旧记忆（一条一行）；`live`：活记忆 id → 说法。
 * 返回按 (byClaimId, step, oldClaimId) 排好的折叠行——同一条活记忆下从新到旧。
 */
export function chainReplaced(links: readonly ReplacedLink[], live: ReadonlyMap<string, string>): ChainedReplaced[] {
  const byOld = new Map(links.map((l) => [l.oldClaimId, l]));
  const out: (ChainedReplaced & { readonly order: number })[] = [];
  for (const link of links) {
    let cur = link.successorId;
    let step = 1;
    const seen = new Set([link.oldClaimId]);
    while (!live.has(cur)) {
      const next = byOld.get(cur);
      if (next === undefined || seen.has(cur) || step >= SUPERSEDE_CHAIN_MAX_STEPS) { cur = ""; break; }
      seen.add(cur);
      cur = next.successorId;
      step += 1;
    }
    if (cur === "") continue;
    const successorStatement = live.get(link.successorId) ?? byOld.get(link.successorId)?.oldStatement;
    out.push({
      byClaimId: cur,
      replaces: { claimId: link.oldClaimId, statement: link.oldStatement },
      // 只有直接挂在活记忆下的那一环能撤销（同 R9）
      undo: step === 1 ? link.undo : null,
      ...(step === 1 ? {} : {
        step, ...(successorStatement === undefined ? {} : { replacedBy: { claimId: link.successorId, statement: successorStatement } }),
      }),
      order: step,
    });
  }
  return out
    .sort((a, b) => a.byClaimId.localeCompare(b.byClaimId) || a.order - b.order || a.replaces.claimId.localeCompare(b.replaces.claimId))
    .map(({ order: _order, ...rest }) => rest);
}
