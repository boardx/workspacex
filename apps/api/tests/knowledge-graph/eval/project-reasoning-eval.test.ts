/**
 * B3-T4（issue #4498）—— 项目推理质量评测集：固定语料 `project-reasoning-corpus.json` + 两个可重复跑的指标。
 *
 * 被测函数是 B3-T3 的 `domain/knowledge-graph/project-reasoning.ts`（与本切片并行开发）。调用形状按协调者 2026-09-28
 * 通报的 T3 签名（本文件只依赖下面列出的字段，多带的不读）：
 *
 *   computeProjectReasoning({ claims, edges, objects, evidence }) → { conflicts, gaps, chains, computedAt }
 *     · claims：`KgClaim[]`；objects：`KgObject[]`；edges：`KgEdge[]`
 *     · evidence：`Record<claimId, KgEvidenceAnchor[]>`（锚点带 `evidenceId` 与六类 `sourceKind`）
 *     · conflicts[]：`{ claimIds: [string, string] }`（同一主张在不同来源里相反；无序二元组）
 *     · gaps[]：`{ claimId: string; kind: "no_evidence" | "single_source" }`（没有任何来源支持 / 只有单一来源）
 *     · chains[]：`{ steps: { evidenceIds: string[] }[] }`（带引用的推理链，每一步引用 evidenceId）
 *
 * 语料里证据按 claim 内联（`claims[].evidence`）便于人读，喂给 T3 时拆成 `claims`（不带 evidence）+ `evidence` 映射。
 * T3 合入前该文件不存在 ⇒ 指标那一节 **skip 而不是红**（`describe.skipIf`），语料自检那一节始终跑。
 *
 * 指标：
 *   · 冲突召回率 = 命中的 expectedConflicts 无序对 / expectedConflicts 总数，**≥ 0.8**（三项目合计）；
 *   · 引用完整率 = chains 里 evidenceIds 能在语料证据里找到的步数 / 总步数，**= 1**（且每步至少一条引用）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { knowledgeGraph as KG, projectEvidence as PE } from "@repo/contracts";
import corpus from "./project-reasoning-corpus.json";

const REASONING_FILE = fileURLToPath(new URL("../../../src/domain/knowledge-graph/project-reasoning.ts", import.meta.url));
const HAS_T3 = existsSync(REASONING_FILE);

/** 评测输入：契约 KgClaim + 证据锚点（T1 形状），只多不少。 */
type CorpusClaim = KG.KgClaim & { readonly evidence: readonly KG.KgEvidenceAnchor[] };
interface CorpusProject {
  readonly projectId: string;
  readonly title: string;
  readonly claims: readonly CorpusClaim[];
  readonly edges: readonly KG.KgEdge[];
  readonly expectedConflicts: readonly { readonly claimIds: readonly string[]; readonly reason: string }[];
  readonly objects: readonly KG.KgObject[];
  readonly expectedGaps: readonly { readonly claimId: string; readonly kind: "no_evidence" | "single_source" }[];
}
/** T3 输出里评测读的字段（见文件头）。 */
interface ReasoningOutput {
  readonly conflicts: readonly { readonly claimIds: readonly string[] }[];
  readonly gaps: readonly { readonly claimId: string; readonly kind: string }[];
  readonly chains: readonly { readonly steps: readonly { readonly evidenceIds: readonly string[] }[] }[];
}
interface ReasoningInput {
  readonly claims: readonly KG.KgClaim[];
  readonly edges: readonly KG.KgEdge[];
  readonly objects: readonly KG.KgObject[];
  readonly evidence: Readonly<Record<string, readonly KG.KgEvidenceAnchor[]>>;
}
type ComputeProjectReasoning = (input: ReasoningInput) => ReasoningOutput;

/** 语料 → T3 输入：证据从 claim 上拆下来，按 claimId 归组。 */
export function toReasoningInput(p: CorpusProject): ReasoningInput {
  const evidence: Record<string, readonly KG.KgEvidenceAnchor[]> = {};
  const claims = p.claims.map((c) => {
    const { evidence: ev, ...claim } = c;
    evidence[c.id] = ev;
    return claim;
  });
  return { claims, edges: p.edges, objects: p.objects, evidence };
}

const PROJECTS = corpus.projects as unknown as readonly CorpusProject[];
const pairKey = (ids: readonly string[]) => [...ids].sort().join("|");

/** 冲突召回率：预期的无序对被某个 conflicts 项完整包含即命中。 */
export function conflictRecall(expected: readonly { claimIds: readonly string[] }[], actual: readonly { claimIds: readonly string[] }[]): number {
  if (expected.length === 0) return 1;
  const found = new Set(actual.map((c) => pairKey(c.claimIds)));
  const hit = expected.filter((e) => found.has(pairKey(e.claimIds)) || actual.some((a) => e.claimIds.every((id) => a.claimIds.includes(id)))).length;
  return hit / expected.length;
}

/** 引用完整率：每一步至少一条 evidenceId，且每条都能在语料证据里找到。 */
export function citationCompleteness(chains: ReasoningOutput["chains"], known: ReadonlySet<string>): { rate: number; steps: number } {
  const steps = chains.flatMap((c) => c.steps);
  if (steps.length === 0) return { rate: 1, steps: 0 };
  const complete = steps.filter((s) => s.evidenceIds.length > 0 && s.evidenceIds.every((id) => known.has(id))).length;
  return { rate: complete / steps.length, steps: steps.length };
}

describe("项目推理评测语料自检（不依赖 T3）", () => {
  it("≥ 3 个项目；每个项目有预期冲突与预期缺口", () => {
    expect(PROJECTS.length).toBeGreaterThanOrEqual(3);
    for (const p of PROJECTS) {
      expect(p.expectedConflicts.length, p.projectId).toBeGreaterThan(0);
      expect(p.expectedGaps.length, p.projectId).toBeGreaterThan(0);
    }
  });

  it("每条 claim 过契约 KgClaim；每条证据过 KgEvidenceAnchor 且带 evidenceId；六类来源各有样本", () => {
    const kinds = new Set<string>();
    for (const p of PROJECTS) {
      for (const c of p.claims) {
        const { evidence, ...claim } = c;
        expect(KG.KgClaim.safeParse(claim).success, `${p.projectId}/${c.id}`).toBe(true);
        expect(claim.scope).toEqual({ kind: "project", id: p.projectId });
        for (const e of evidence) {
          expect(KG.KgEvidenceAnchor.safeParse(e).success, `${c.id}/${e.segmentId}`).toBe(true);
          expect(e.evidenceId, `${c.id}/${e.segmentId}`).toBeTruthy();
          kinds.add(e.sourceKind);
        }
        expect(c.supportingCount).toBe(evidence.filter((e) => e.stance === "supporting").length);
      }
      for (const e of p.edges) expect(KG.KgEdge.safeParse(e).success, e.id).toBe(true);
    }
    expect([...kinds].sort()).toEqual([...PE.ProjectEvidenceSourceKind.options].sort());
  });

  it("预期冲突 / 缺口都指向本项目存在的 claim；缺口标注与证据事实一致；evidenceId 全局唯一", () => {
    const seen = new Set<string>();
    for (const p of PROJECTS) {
      const byId = new Map(p.claims.map((c) => [c.id, c]));
      for (const x of p.expectedConflicts) {
        expect(x.claimIds.length).toBeGreaterThanOrEqual(2);
        for (const id of x.claimIds) expect(byId.has(id), `${p.projectId}/${id}`).toBe(true);
      }
      for (const g of p.expectedGaps) {
        const c = byId.get(g.claimId);
        expect(c, `${p.projectId}/${g.claimId}`).toBeDefined();
        const supporting = c!.evidence.filter((e) => e.stance === "supporting" && !e.revoked);
        if (g.kind === "no_evidence") expect(supporting).toHaveLength(0);
        else expect(new Set(supporting.map((e) => e.sourceKind)).size, `${g.claimId} single_source`).toBe(1);
      }
      for (const c of p.claims) for (const e of c.evidence) {
        expect(seen.has(e.evidenceId!), `duplicate ${e.evidenceId}`).toBe(false);
        seen.add(e.evidenceId!);
      }
    }
  });

  it("语料 → T3 输入：claims 不再带 evidence，evidence 按 claimId 归组，objects 过契约 KgObject", () => {
    for (const p of PROJECTS) {
      const input = toReasoningInput(p);
      expect(input.claims.every((c) => !("evidence" in c))).toBe(true);
      expect(Object.keys(input.evidence).sort()).toEqual(p.claims.map((c) => c.id).sort());
      for (const o of input.objects) expect(KG.KgObject.safeParse(o).success, o.id).toBe(true);
    }
  });

  it("指标函数自身：召回率按无序对算；引用完整率对空链为 1、缺引用 / 引用未知证据为不完整", () => {
    expect(conflictRecall([{ claimIds: ["a", "b"] }, { claimIds: ["c", "d"] }], [{ claimIds: ["b", "a"] }])).toBe(0.5);
    expect(conflictRecall([{ claimIds: ["a", "b"] }], [{ claimIds: ["a", "b", "c"] }])).toBe(1);
    const known = new Set(["ev-1", "ev-2"]);
    expect(citationCompleteness([], known)).toEqual({ rate: 1, steps: 0 });
    expect(citationCompleteness([{ steps: [{ evidenceIds: ["ev-1"] }, { evidenceIds: [] }] }], known)).toEqual({ rate: 0.5, steps: 2 });
    expect(citationCompleteness([{ steps: [{ evidenceIds: ["ev-1", "ev-9"] }] }], known)).toEqual({ rate: 0, steps: 1 });
  });
});

describe.skipIf(!HAS_T3)("项目推理质量指标（T3 computeProjectReasoning）", () => {
  async function load(): Promise<ComputeProjectReasoning> {
    const mod = (await import(/* @vite-ignore */ REASONING_FILE)) as { computeProjectReasoning?: unknown };
    expect(typeof mod.computeProjectReasoning, "project-reasoning.ts 应导出 computeProjectReasoning").toBe("function");
    return mod.computeProjectReasoning as ComputeProjectReasoning;
  }

  it("跨来源冲突召回率 ≥ 0.8（三项目合计）", async () => {
    const compute = await load();
    const expected: { claimIds: readonly string[] }[] = [];
    const actual: { claimIds: readonly string[] }[] = [];
    for (const p of PROJECTS) {
      const out = compute(toReasoningInput(p));
      expect(Array.isArray(out.conflicts), p.projectId).toBe(true);
      expected.push(...p.expectedConflicts.map((c) => ({ claimIds: c.claimIds.map((id) => `${p.projectId}:${id}`) })));
      actual.push(...out.conflicts.map((c) => ({ claimIds: c.claimIds.map((id) => `${p.projectId}:${id}`) })));
    }
    const recall = conflictRecall(expected, actual);
    expect(recall, `conflict recall ${recall} (expected ${expected.length}, reported ${actual.length})`).toBeGreaterThanOrEqual(0.8);
  });

  it("缺口建议：标注为 no_evidence / single_source 的每一条都被报出（同一 claimId + kind），召回 ≥ 0.8", async () => {
    const compute = await load();
    let expectedGaps = 0;
    let hit = 0;
    for (const p of PROJECTS) {
      const out = compute(toReasoningInput(p));
      const reported = new Set(out.gaps.map((g) => `${g.claimId}|${g.kind}`));
      for (const g of p.expectedGaps) {
        expectedGaps += 1;
        if (reported.has(`${g.claimId}|${g.kind}`)) hit += 1;
      }
    }
    expect(hit / expectedGaps, `gap recall ${hit}/${expectedGaps}`).toBeGreaterThanOrEqual(0.8);
  });

  it("引用完整率 = 1：推理链每一步都引用 evidenceId，且都在语料证据里", async () => {
    const compute = await load();
    let steps = 0;
    for (const p of PROJECTS) {
      const out = compute(toReasoningInput(p));
      const known = new Set(p.claims.flatMap((c) => c.evidence.map((e) => e.evidenceId!)));
      const r = citationCompleteness(out.chains, known);
      steps += r.steps;
      expect(r.rate, `${p.projectId} citation completeness`).toBe(1);
    }
    expect(steps, "至少要有一条带引用的推理链").toBeGreaterThan(0);
  });
});
