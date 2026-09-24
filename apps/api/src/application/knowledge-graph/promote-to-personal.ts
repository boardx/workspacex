/**
 * Phase 18 F11 —— 晋升到个人空间 + AI 提名（uc-18-4，契约 promoteToPersonal / listPromotionNominations）。
 *
 * 顺序：会话可见 → 是所有者（R5）→ 是个人线程（E2）→ 逐条：去重判断 → 执行（数据库复核不变量）。
 * 逐条部分成功（E4）：一条被拒不影响其余；被拒的原因用契约里的逐条码返回。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { dedupAgainstPersonal } from "../../domain/knowledge-graph/promotion";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";
import { KgHumanActionError, type PromotionItemResult, type PromotionPort } from "./ports";

export interface PromotionDeps extends KnowledgeReadDeps {
  readonly promotion: PromotionPort;
  readonly newId: (prefix: "act") => string;
}

interface Input {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
}

async function requirePersonalOwner(deps: PromotionDeps, input: Input) {
  const t = await visibleThread(deps, input, input.threadId);
  if (t.facts.createdBy !== input.userId) throw new KgHumanActionError("KG_NOT_OWNER");
  if (t.facts.projectId !== null) throw new KgHumanActionError("KG_SCOPE_NOT_PERSONAL");
  const reveal = <T>(g: Guarded<T>): T => {
    const d = discloseDecided(g, t.base);
    if (!isDisclosed(d)) throw new KgHumanActionError("KG_NOT_OWNER");
    return d.payload;
  };
  return { ref: t.ref, reveal };
}

const REJECT_CODES = new Set<string>(KG.KgPromotionRejectCode.options);

export async function promoteToPersonal(
  deps: PromotionDeps,
  input: Input & {
    readonly claimIds: readonly string[];
    readonly choices?: readonly { readonly claimId: string; readonly choice: "merge" | "coexist" }[];
  },
): Promise<{ readonly results: readonly PromotionItemResult[] }> {
  if (input.claimIds.length > KG.KG_PROMOTE_MAX_BATCH) throw new KgHumanActionError("KG_PROMOTE_BATCH_TOO_LARGE");
  const t = await requirePersonalOwner(deps, input);
  const choices = new Map((input.choices ?? []).map((c) => [c.claimId, c.choice]));
  const source = new Map(t.reveal(await deps.promotion.threadClaims(input.orgId, input.userId, t.ref, input.claimIds)).map((c) => [c.id, c]));
  const results: PromotionItemResult[] = [];
  for (const claimId of [...new Set(input.claimIds)]) {
    const src = source.get(claimId);
    if (src === undefined) {
      results.push({ claimId, outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" });
      continue;
    }
    // 每条都重新读一次个人空间：同一批里前一条刚晋升的，后一条要能看见（不然同一句话会被复制两份）。
    const verdict = dedupAgainstPersonal(src.statement, t.reveal(await deps.promotion.personalClaims(input.orgId, input.userId, t.ref)));
    const choice = choices.get(claimId);
    if (verdict.kind === "similar" && choice === undefined) {
      results.push({ claimId, outcome: "needs_choice", existingPersonalClaimId: verdict.existingId });
      continue;
    }
    const merge = verdict.kind === "duplicate" || (verdict.kind === "similar" && choice === "merge");
    try {
      const personalClaimId = await deps.promotion.promote(input.orgId, input.userId, {
        actionId: deps.newId("act"), threadId: input.threadId, claimId,
        mode: merge ? "merge" : "new",
        ...(merge && (verdict.kind === "duplicate" || verdict.kind === "similar") ? { targetClaimId: verdict.existingId } : {}),
      });
      results.push(merge
        ? { claimId, outcome: "merged_into_existing", personalClaimId }
        : verdict.kind === "similar" ? { claimId, outcome: "coexisting", personalClaimId } : { claimId, outcome: "promoted", personalClaimId });
    } catch (e) {
      if (e instanceof KgHumanActionError && REJECT_CODES.has(e.code)) {
        results.push({ claimId, outcome: "rejected", code: e.code as KG.KgPromotionRejectCode });
        continue;
      }
      throw e;  // 所有者 / 作用域类的错误对整批都一样，照常抛出
    }
  }
  return { results };
}

/** AI 提名（A1）：只列候选，不执行。理由是给人看的一句话，不出现内部术语（06-UX R5）。 */
export async function listPromotionNominations(
  deps: PromotionDeps,
  input: Input,
): Promise<{ readonly nominations: readonly { readonly claimId: string; readonly rationale: string }[] }> {
  const t = await requirePersonalOwner(deps, input);
  const rows = t.reveal(await deps.promotion.nominationCandidates(input.orgId, input.userId, t.ref));
  const rank = (r: { kind: string; status: string }) => (r.status === "accepted" ? 0 : 2) + (r.kind === "decision" ? 0 : 1);
  const rationale = (r: { kind: string; status: string }) => {
    if (r.kind === "decision") return r.status === "accepted" ? "你确认过的决定，以后的对话很可能还会用到" : "对话里拍板的决定，以后的对话很可能还会用到";
    if (r.kind === "todo") return "还没完成的待办，换个对话也值得记着";
    if (r.kind === "risk") return "提到的风险，之后做决定时值得想起来";
    return r.status === "accepted" ? "你确认过的事实" : "对话里提到的事实";
  };
  const top = [...rows].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).slice(0, 5);
  return { nominations: top.map((r) => ({ claimId: r.id, rationale: rationale(r) })) };
}
