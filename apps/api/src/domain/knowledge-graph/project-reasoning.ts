/**
 * B3-T3（issue #4497）—— 项目大脑的跨来源推理：冲突检测、缺口建议、带引用的推理链。
 *
 * 纯函数、确定性、不调模型：同一份输入永远得到同一份输出（评测集 T4 靠这一点断言召回率 / 引用完整率）。
 * 输入与 `getProjectKnowledge.out` 同形的结论 / 边 / 实体，再加每条结论的证据锚点（`KgEvidenceAnchor[]`，
 * 由读端口 `projectClaimEvidence` 提供）；输出即契约 `getProjectReasoning.out` 的三块（`computedAt` 由用例补）。
 *
 * ## 三条规则
 *   1. **冲突**：任意两条 fact / decision，判定复用 F16 `conflict.ts` 的 `statementsConflict`（同一组人和事、同一指标、
 *      不同数值；宁可漏不可误）。分类：双方**未撤回的支持**证据合起来来自 ≥ 2 类来源 ⇒ `cross_source`，否则 `same_source`
 *      （只有一类来源、或双方都没证据）。「同来源相反」仍是冲突，只是不算跨来源。
 *   2. **缺口**：hypothesis / decision 的支持 = 自己的直接证据 ∪ 前提（沿 derived_from / supported_by 向上游、有界）的直接证据。
 *      一类都没有 ⇒ `no_evidence`；恰好一类 ⇒ `single_source`。建议是按来源类型查表的固定模板。
 *   3. **推理链**：同一批 hypothesis / decision，前提 = 上游结论（每条一步，带它的证据引用）+ 自己的每条直接证据（每条一步，
 *      引用 `evidenceId`；老数据没有 `evidenceId` 时以所属结论的 `claimId` 兜底，界面回退到来源抽屉）；推论 = 结论本身，
 *      汇总全部引用。没有任何前提 ⇒ 不出链（它已在缺口里）。每一步都满足「至少一个 evidenceId 或 claimId」。
 *
 * 已撤回的证据（`revoked`）三块都不计；`contradicting` 的证据不算支持。
 */
import { knowledgeGraph as KG, projectEvidence as PE } from "@repo/contracts";
import { statementsConflict } from "./conflict";

type Claim = KG.KgClaim;
type Edge = KG.KgEdge;
type Anchor = KG.KgEvidenceAnchor;
type SourceKind = PE.ProjectEvidenceSourceKind;

export interface ProjectReasoningInput {
  readonly claims: readonly Claim[];
  readonly edges: readonly Edge[];
  /** 实体（结论的 `aboutObjectIds` 指向它们）；冲突判定要用实体**名**比对 */
  readonly objects: readonly Pick<KG.KgObject, "id" | "name">[];
  /** claimId → 它的证据锚点（含已撤回的，这里过滤） */
  readonly evidence: Readonly<Record<string, readonly Anchor[]>>;
}

export interface ProjectReasoning {
  readonly conflicts: KG.KgReasoningConflict[];
  readonly gaps: KG.KgReasoningGap[];
  readonly chains: KG.KgReasoningChain[];
}

/** 出链 / 查缺口的结论类型：「猜测」与「决定」是要拿证据撑住的两类；事实 / 待办 / 风险 / 目标 / 偏好不在此列。 */
const REASONED_KINDS: ReadonlySet<KG.KgClaimKind> = new Set(["hypothesis", "decision"]);
/** 沿这两种边向上游找前提（src 是下游、dst 是上游） */
const PREMISE_RELATIONS: ReadonlySet<KG.KgRelation> = new Set(["derived_from", "supported_by"]);
/** 前提向上游最多走几层：够用（L0 → L1 → L2 也只有两跳），也挡住环 */
const PREMISE_MAX_DEPTH = 4;

const SOURCE_ORDER: readonly SourceKind[] = PE.ProjectEvidenceSourceKind.options;
const sourceRank = (k: SourceKind): number => SOURCE_ORDER.indexOf(k);
const sortKinds = (kinds: Iterable<SourceKind>): SourceKind[] => [...new Set(kinds)].sort((a, b) => sourceRank(a) - sourceRank(b));

/** 「只有 X 支持，建议用 Y 验证」的 Y——按已有的那一类来源查表（单一事实源：改文案只改这里）。 */
const SINGLE_SOURCE_ADVICE: Readonly<Record<SourceKind, string>> = {
  chat_message: "访谈或问卷",
  attachment: "访谈或问卷",
  survey_response: "访谈",
  interview_segment: "问卷",
  transcript_segment: "访谈或问卷",
  research_source: "访谈或问卷",
  whiteboard_note: "访谈或问卷",
};

const NO_EVIDENCE_ADVICE: Readonly<Record<"hypothesis" | "decision", string>> = {
  hypothesis: "还没有任何来源支持这条猜测，建议先用访谈或问卷验证。",
  decision: "这个决定还没有任何来源支持，建议补上做出它所依据的材料。",
};

/** 缺口建议文案（导出给单测与界面对账用；确定性模板）。 */
export function gapSuggestion(kind: "hypothesis" | "decision", sourceKinds: readonly SourceKind[]): string {
  if (sourceKinds.length === 0) return NO_EVIDENCE_ADVICE[kind];
  const only = sourceKinds[0]!;
  return `只有${PE.PROJECT_EVIDENCE_SOURCE_LABEL_ZH[only]}支持，建议用${SINGLE_SOURCE_ADVICE[only]}验证。`;
}

/** 一条结论**自己的**有效支持证据：未撤回、stance = supporting。顺序按输入（读端口按 created_at 排好）。 */
function liveSupport(input: ProjectReasoningInput, claimId: string): Anchor[] {
  return (input.evidence[claimId] ?? []).filter((a) => !a.revoked && a.stance === "supporting");
}

/** 沿 derived_from / supported_by 向上游的前提结论（只取输入集合里活着的），BFS、去重、有界。 */
function premisesOf(input: ProjectReasoningInput, byId: ReadonlyMap<string, Claim>, root: Claim): Claim[] {
  const upstream = new Map<string, string[]>();
  for (const e of input.edges) {
    if (e.src.kind !== "claim" || e.dst.kind !== "claim" || !PREMISE_RELATIONS.has(e.relation)) continue;
    upstream.set(e.src.id, [...(upstream.get(e.src.id) ?? []), e.dst.id]);
  }
  const out: Claim[] = [];
  const seen = new Set<string>([root.id]);
  let frontier = [root];
  for (let depth = 0; depth < PREMISE_MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: Claim[] = [];
    for (const c of frontier) {
      const ids = [...(upstream.get(c.id) ?? []), ...(c.derivedFromClaimId === null ? [] : [c.derivedFromClaimId])];
      for (const id of ids) {
        const p = byId.get(id);
        if (p === undefined || seen.has(id)) continue;
        seen.add(id);
        out.push(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return out;
}

const evidenceIds = (anchors: readonly Anchor[]): string[] => [...new Set(anchors.flatMap((a) => (a.evidenceId === undefined ? [] : [a.evidenceId])))];

export function computeProjectReasoning(input: ProjectReasoningInput): ProjectReasoning {
  const byId = new Map(input.claims.map((c) => [c.id, c] as const));
  const nameOf = new Map(input.objects.map((o) => [o.id, o.name] as const));
  const claims = [...input.claims].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  // ① 冲突：两两比对（先记下的在 A）。
  const conflicts: KG.KgReasoningConflict[] = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i]!;
      const b = claims[j]!;
      const about = (c: Claim) => c.aboutObjectIds.flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : []));
      if (!statementsConflict({ kind: a.kind, statement: a.statement, about: about(a) }, { kind: b.kind, statement: b.statement, about: about(b) })) continue;
      const sa = liveSupport(input, a.id);
      const sb = liveSupport(input, b.id);
      const kindsA = sortKinds(sa.map((x) => x.sourceKind));
      const kindsB = sortKinds(sb.map((x) => x.sourceKind));
      conflicts.push({
        id: `conflict:${a.id}:${b.id}`,
        claimIds: [a.id, b.id],
        statementA: a.statement,
        statementB: b.statement,
        sourceKindsA: kindsA,
        sourceKindsB: kindsB,
        evidenceIdsA: evidenceIds(sa),
        evidenceIdsB: evidenceIds(sb),
        kind: new Set([...kindsA, ...kindsB]).size >= 2 ? "cross_source" : "same_source",
      });
    }
  }

  // ② ③ 缺口与推理链：同一批猜测 / 决定，同一份「前提 + 直接证据」。
  const gaps: KG.KgReasoningGap[] = [];
  const chains: KG.KgReasoningChain[] = [];
  for (const c of claims) {
    if (!REASONED_KINDS.has(c.kind)) continue;
    const kind = c.kind as "hypothesis" | "decision";
    const own = liveSupport(input, c.id);
    const premises = premisesOf(input, byId, c);
    const steps: KG.KgReasoningStep[] = [];
    const allKinds: SourceKind[] = own.map((a) => a.sourceKind);
    const allEvidence: string[] = evidenceIds(own);
    for (const p of premises) {
      const ps = liveSupport(input, p.id);
      allKinds.push(...ps.map((a) => a.sourceKind));
      allEvidence.push(...evidenceIds(ps));
      steps.push({ kind: "premise", text: p.statement, evidenceIds: evidenceIds(ps), sourceKinds: sortKinds(ps.map((a) => a.sourceKind)), claimId: p.id });
    }
    for (const a of own) {
      const text = a.excerpt.trim().length > 0 ? a.excerpt : `（${PE.PROJECT_EVIDENCE_SOURCE_LABEL_ZH[a.sourceKind]}）`;
      steps.push(a.evidenceId === undefined
        ? { kind: "premise", text, evidenceIds: [], sourceKinds: [a.sourceKind], claimId: c.id }
        : { kind: "premise", text, evidenceIds: [a.evidenceId], sourceKinds: [a.sourceKind] });
    }
    const sourceKinds = sortKinds(allKinds);
    if (sourceKinds.length <= 1) {
      gaps.push({ claimId: c.id, statement: c.statement, kind: sourceKinds.length === 0 ? "no_evidence" : "single_source", sourceKinds, suggestion: gapSuggestion(kind, sourceKinds) });
    }
    if (steps.length > 0) {
      steps.push({ kind: "inference", text: c.statement, evidenceIds: [...new Set(allEvidence)], sourceKinds, claimId: c.id });
      chains.push({ claimId: c.id, statement: c.statement, steps });
    }
  }
  // 缺口：没证据的先于只有一类的；同类内按记下的先后（claims 已排好）。
  gaps.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "no_evidence" ? -1 : 1));
  return { conflicts, gaps, chains };
}
