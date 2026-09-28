/**
 * S7（#4364）—— 引用 chip 的纠正（「这条不对」/「已过时」）与纠正率。单独一个文件，不往 ports.ts 里堆
 * （S4b / S6 / S8 同时在改那里）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type CitationCorrectionOut = z.infer<typeof KG.knowledgeGraph.correctCitation.out>;
export type CitationMetricsOut = z.infer<typeof KG.knowledgeGraph.getCitationMetrics.out>;

/** 一次纠正要落在哪：这条对话里的这条回答上的这一条引用。 */
export interface CitationTarget {
  readonly actionId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly claimId: string;
}

/** 算被引用次数用的原料：本人提问的每条回答的正文 + 那一轮召回到的结论原文（按召回名次）。 */
export interface CitedTurnSource {
  readonly answer: string;
  readonly recalled: readonly { readonly claimId: string; readonly statement: string }[];
}

export interface CitationMetricsSource {
  readonly turns: readonly CitedTurnSource[];
  readonly corrections: { readonly wrong: number; readonly expired: number };
}

export interface CitationCorrectionPort {
  /**
   * 「这条不对」：没给新说法 ⇒ 忘掉；给了 ⇒ 用新说法取代。数据库复核所有者、提问人、召回集合与结论现状
   * （`kg_correct_citation`）；被拒时抛 `KgHumanActionError`。同时记一条纠正事件。
   */
  retract(orgId: OrgId, userId: string, target: CitationTarget, replacement: string | null): Promise<CitationCorrectionOut>;
  /**
   * 本人最近 `windowDays` 天提问的回答（算分母用）与纠正次数（分子）。内容挂在本人个人空间的 guard ref 上
   * （`personal:<userId>`）：回答正文与个人空间结论原文只给本人，应用层按 `decidePersonalSpace` 判了才拿得到。
   */
  metricsSource(orgId: OrgId, userId: string, windowDays: number): Promise<Guarded<CitationMetricsSource>>;
}

export const CITATION_CORRECTION_PORT = Symbol("CitationCorrectionPort");

/**
 * 「已过时」的领域操作 `expireClaim`。
 *
 * 实现（`PgCitationCorrection.expireClaim`，迁移 20260928220000）：被点那条的整家 `valid_to = now()`——S6（#4363）的有效期，
 * 不撤回：/brain 与记忆面板照旧列出、标「已过期」，召回不再用它。纠正事件（纠正率的分子）照旧记一行 `kg_citation_corrections`。
 */
export interface ClaimExpiryPort {
  expireClaim(orgId: OrgId, userId: string, target: CitationTarget): Promise<void>;
}

export const CLAIM_EXPIRY_PORT = Symbol("ClaimExpiryPort");
