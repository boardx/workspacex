/**
 * Phase 20 CT03 —— 研究线产出组装（契约束 work-content I-C6 证据 / I-C9 终局；05 号 R3 步骤 3–4、R4 A4）。
 *
 * 纯函数、无 IO。规则：
 * - 结论只能引用检索阶段真实返回的材料 ref；引用为空或引用了不存在材料的结论在证据评审（S171）被剔除；
 * - 没有可检索材料、或评审后没有一条站得住的结论 → 数据需求说明（DataNeedsStatement），不编造结论；
 * - 分发门 G3：收件人类别含 board / regulator / external_partner 时需两名不同审批人（双签）。
 */
import { createHash } from "node:crypto";
import { DataNeedsStatement, ResearchBrief } from "@repo/contracts/work-content";
import type { z } from "zod";

export type ResearchBriefOutput = z.infer<typeof ResearchBrief>;
export type DataNeedsOutput = z.infer<typeof DataNeedsStatement>;

export interface ResearchMaterial {
  readonly ref: string;
  readonly text: string;
}

export interface DraftClaim {
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly confidence: "low" | "medium" | "high";
}

/** D002 文档第 82 行：这些收件人类别分发前须双签。 */
export const DUAL_SIGN_RECIPIENT_CATEGORIES = ["board", "regulator", "external_partner"] as const;

export function requiresDualSign(recipientCategories: readonly string[]): boolean {
  return recipientCategories.some((c) => (DUAL_SIGN_RECIPIENT_CATEGORIES as readonly string[]).includes(c));
}

/** G3 签核是否达标：双签时需两个不同审批人，且都不是发起人（R5：不能审批自己发起的门）。 */
export function distributionSignoffSatisfied(
  recipientCategories: readonly string[],
  approverUserIds: readonly string[],
  initiatorUserId: string,
): boolean {
  const distinct = new Set(approverUserIds.filter((u) => u !== initiatorUserId));
  return distinct.size >= (requiresDualSign(recipientCategories) ? 2 : 1);
}

/** S171 证据评审：保留证据非空且全部指向已检索材料的结论（去重引用）。 */
export function auditClaims(claims: readonly DraftClaim[], materials: readonly ResearchMaterial[]): DraftClaim[] {
  const known = new Set(materials.map((m) => m.ref));
  return claims
    .map((c) => ({ ...c, evidenceRefs: [...new Set(c.evidenceRefs)] }))
    .filter((c) => c.text.trim().length > 0 && c.evidenceRefs.length > 0 && c.evidenceRefs.every((r) => known.has(r)));
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildResearchBrief(title: string, claims: readonly DraftClaim[], risks: readonly DraftClaim[]): ResearchBriefOutput {
  const body = {
    kind: "research_brief" as const,
    title,
    claims: claims.map((c, i) => ({ claimId: `c${i + 1}`, text: c.text, evidenceRefs: [...c.evidenceRefs], confidence: c.confidence })),
    risks: risks.map((c, i) => ({ claimId: `r${i + 1}`, text: c.text, evidenceRefs: [...c.evidenceRefs], confidence: c.confidence })),
  };
  return ResearchBrief.parse({ ...body, digest: digestOf(body) });
}

export function buildDataNeedsStatement(question: string, missing: readonly string[]): DataNeedsOutput {
  const body = { kind: "data_needs_statement" as const, question, missing: [...missing] };
  return DataNeedsStatement.parse({ ...body, digest: digestOf(body) });
}
