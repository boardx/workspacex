/**
 * S7（#4364）—— 回答下引用 chip 上的当场纠正（「这条不对」/「已过时」）与纠正率。
 *
 * 纠正的顺序：会话可见（同读接口，看不见 = 不存在）→ 是会话所有者（同 F10）→ 这条是这一轮**对账后**的引用
 * （同一个 `getTurnMemory` 读出来的 `cited`：召回集合里、且回答真的用到了；查看者就是这一轮的提问人时才有个人空间的条目）
 * → 交数据库执行（`kg_correct_citation` 再复核一遍所有者 / 提问人 / 召回集合 / 结论现状，并记纠正事件）。
 * 不是引用 ⇒ 同一个 `KG_CLAIM_NOT_FOUND`：不借这个口子探测别的结论是否存在。
 *
 * 纠正率 = 纠正次数 / 被引用次数。被引用次数不另存：按同一个对账判据（domain/knowledge-graph/citation.ts）
 * 从本人提问的回答正文 + 那一轮的召回集合复算——chip 与指标永远是同一个口径。
 */
import type { OrgId } from "../../domain/org-id";
import { citationCorrectionRate, reconcileCitations } from "../../domain/knowledge-graph/citation";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { decidePersonalSpace } from "./read-personal-knowledge";
import { getTurnMemory, visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";
import { KgHumanActionError } from "./ports";
import type {
  CitationCorrectionOut, CitationCorrectionPort, CitationMetricsOut, ClaimExpiryPort,
} from "./citation-ports";

export interface CitationCorrectionDeps extends KnowledgeReadDeps {
  readonly corrections: CitationCorrectionPort;
  readonly expiry: ClaimExpiryPort;
  readonly newId: (prefix: "act") => string;
}

/** 纠正率的时间窗（天）。 */
export const CITATION_METRICS_WINDOW_DAYS = 30;

export async function correctCitation(
  deps: CitationCorrectionDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly messageId: string;
    readonly claimId: string;
    readonly kind: "wrong" | "expired";
    readonly replacement?: string;
  },
): Promise<CitationCorrectionOut> {
  if (input.kind === "expired" && input.replacement !== undefined) throw new KgHumanActionError("KG_INVALID_REQUEST");
  const t = await visibleThread(deps, input, input.threadId);
  if (t.facts.createdBy !== input.userId) throw new KgHumanActionError("KG_NOT_OWNER");
  const turn = await getTurnMemory(deps, input);
  const cited = turn.cited ?? [];
  if (!cited.includes(input.claimId)) throw new KgHumanActionError("KG_CLAIM_NOT_FOUND");
  const target = { actionId: deps.newId("act"), threadId: input.threadId, messageId: input.messageId, claimId: input.claimId };
  if (input.kind === "expired") {
    await deps.expiry.expireClaim(input.orgId, input.userId, target);
    return { outcome: "expired", newClaimId: null };
  }
  const replacement = input.replacement?.trim();
  return deps.corrections.retract(input.orgId, input.userId, target, replacement === undefined || replacement === "" ? null : replacement);
}

export async function getCitationMetrics(
  deps: KnowledgeReadDeps & Pick<CitationCorrectionDeps, "corrections">,
  input: { readonly userId: string; readonly orgId: OrgId },
): Promise<CitationMetricsOut> {
  const guarded = await deps.corrections.metricsSource(input.orgId, input.userId, CITATION_METRICS_WINDOW_DAYS);
  const d = discloseDecided(guarded, await decidePersonalSpace(deps, input, guarded));
  // 不是（或已不是）本组织成员：契约说全 0、不是错误（本人的数字，没有可探测的存在性）。
  const src = isDisclosed(d) ? d.payload : { turns: [], corrections: { wrong: 0, expired: 0 } };
  const citedUses = src.turns.reduce((n, t) => n + reconcileCitations(t.answer, t.recalled).length, 0);
  const total = src.corrections.wrong + src.corrections.expired;
  return {
    windowDays: CITATION_METRICS_WINDOW_DAYS,
    citedUses,
    corrections: { wrong: src.corrections.wrong, expired: src.corrections.expired },
    correctionRate: citationCorrectionRate(total, citedUses),
  };
}
