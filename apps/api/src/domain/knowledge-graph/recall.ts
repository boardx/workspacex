/**
 * Phase 18 F08 —— 会话知识的混合召回（uc-18-2），纯函数部分。
 *
 * 三路：
 *   - fts（字面）：问题与结论文本的词 / 二字组重合。Postgres 默认解析器不切中文
 *     （GAP-CE-FTS-CJK-SEGMENTATION），所以这里在候选集（本会话的活结论，量级几十到几百）上用
 *     二字组重合打分，不依赖 tsvector。
 *   - graph（关联）：问题里提到的实体（graphSeeds）→ AGE 邻域里的结论。**只加分**：图路命中但与问题
 *     毫无字面关联的结论，排在字面命中之后；关掉图路，结果集仍然合理（R7-2）。
 *   - vector：本阶段没有嵌入流水线（F05 不在 MVP），记为 available = false，不静默略过（R4-E2）。
 * 融合用 RRF（与 domain/retrieval/rrf.ts 同一个 k），最后按三态加一点权：你确认过的优先于 AI 记下的。
 */
import type { contextPack as CP, knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import { normalizeName } from "./extraction";

export type RecallChannel = z.infer<typeof CP.RetrievalChannel>;
type FilterAction = z.infer<typeof CP.FilterAction>;

export interface RecallObject {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface RecallClaim {
  readonly id: string;
  readonly statement: string;
  readonly kind: KG.KgClaimKind;
  readonly triState: KG.KgTriState;
  /** 结论最早一条证据消息的时间（给回答里标「来自你 9/20 的对话」用）。 */
  readonly saidAt: string | null;
  /** 这条结论属于哪个作用域：本会话（L0）或本人个人空间（L1，F12）。 */
  readonly scope: "chat_session" | "personal";
}

export interface GraphHop {
  readonly src: string;
  readonly relation: string;
  readonly dst: string;
}

/** 图路的一条命中：到达的结论 + 实际走过的边（按遍历顺序）。 */
export interface GraphHit {
  readonly claimId: string;
  readonly path: readonly GraphHop[];
}

export interface RecallItem {
  readonly claim: RecallClaim;
  readonly channels: readonly RecallChannel[];
  readonly retrievalReasons: readonly FilterAction[];
  readonly score: number;
  /** 只在经图路召回时出现：召回实际走过的边（context-pack delta D-KG-2 的形状，D-I2）。 */
  readonly graphPath: readonly GraphHop[] | null;
}

export interface RecallChannelPlan {
  readonly channel: RecallChannel;
  readonly weight: number;
  readonly hitCount: number;
  /** 这次这一路有没有真的执行（context-pack delta D-KG-1；D-I1：false ⇒ hitCount = 0）。 */
  readonly available: boolean;
}

export interface KnowledgeRecall {
  readonly items: readonly RecallItem[];
  readonly plan: readonly RecallChannelPlan[];
  /** 问题里解析出的实体（给可解释性 / 测试看）。 */
  readonly graphSeeds: readonly string[];
}

const RRF_K = 60;
const MIN_SEED_LENGTH = 2;

/** 问题里提到了哪些已知实体（名字或别名作为子串出现，归一后比较）。太短的名字不当种子，免得「A」命中一切。 */
export function graphSeeds(query: string, objects: readonly RecallObject[]): string[] {
  const q = normalizeName(query);
  return objects
    .filter((o) => [o.name, ...o.aliases].some((n) => {
      const k = normalizeName(n);
      return k.length >= MIN_SEED_LENGTH && q.includes(k);
    }))
    .map((o) => o.id);
}

/** 词元：连续的拉丁字母 / 数字串（≥ 2），以及每段汉字的所有二字组。 */
export function lexicalTokens(text: string): Set<string> {
  const t = normalizeName(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  for (const m of t.matchAll(/[㐀-鿿]+/g)) {
    const s = m[0];
    if (s.length === 1) continue;
    for (let i = 0; i + 1 < s.length; i += 1) out.add(s.slice(i, i + 2));
  }
  return out;
}

/** 问题词元里有多少出现在结论里（0..1）。 */
export function lexicalScore(query: Set<string>, statement: string): number {
  if (query.size === 0) return 0;
  const s = lexicalTokens(statement);
  let hit = 0;
  for (const t of query) if (s.has(t)) hit += 1;
  return hit / query.size;
}

const TRI_STATE_BONUS: Record<KG.KgTriState, number> = { confirmed: 0.004, pending: 0, conflict: -0.002 };

/**
 * 查询意图（query-planned，同 domain/retrieval/channel-plan.ts 的思路）：问「谁定的 / 谁拍板」时，
 * 决定类结论比同样字面命中的事实、风险更可能是答案。加分量级大于三态加分、小于一个 RRF 名次差，
 * 只在字面 / 图路打平时起作用，不会把不相关的决定顶上来。
 */
const WHO_DECIDED = /谁|哪位|拍板|决定|who|decid/i;
function intentBonus(query: string, kind: KG.KgClaimKind): number {
  return WHO_DECIDED.test(query) && kind === "decision" ? 0.006 : 0;
}

export interface FuseInput {
  readonly query: string;
  readonly claims: readonly RecallClaim[];
  readonly objects: readonly RecallObject[];
  /** null ⇒ 图路这次没执行（AGE 不可用）。 */
  readonly graph: readonly GraphHit[] | null;
  readonly limit: number;
  /** 字面分数低于它的不算字面命中。 */
  readonly minLexical?: number;
}

export function fuseRecall(input: FuseInput): KnowledgeRecall {
  const minLexical = input.minLexical ?? 0.2;
  const seeds = graphSeeds(input.query, input.objects);
  const qTokens = lexicalTokens(input.query);
  const byId = new Map(input.claims.map((c) => [c.id, c]));

  const lexical = input.claims
    .map((c) => ({ c, s: lexicalScore(qTokens, c.statement) }))
    .filter((x) => x.s >= minLexical)
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));

  // 图路命中只保留候选集里的结论（作用域与可见性由候选集决定：图里是全 org 的 id）。
  const graphBest = new Map<string, GraphHit>();
  for (const h of input.graph ?? []) {
    if (!byId.has(h.claimId)) continue;
    const prev = graphBest.get(h.claimId);
    if (prev === undefined || h.path.length < prev.path.length) graphBest.set(h.claimId, h);
  }
  const graphRanked = [...graphBest.values()].sort((a, b) => a.path.length - b.path.length || a.claimId.localeCompare(b.claimId));

  const score = new Map<string, number>();
  const channels = new Map<string, Set<RecallChannel>>();
  const add = (id: string, ch: RecallChannel, rank: number, weight: number) => {
    score.set(id, (score.get(id) ?? 0) + weight / (RRF_K + rank + 1));
    (channels.get(id) ?? channels.set(id, new Set()).get(id)!).add(ch);
  };
  lexical.forEach((x, i) => add(x.c.id, "fts", i, 1));
  // 图路权重 0.5：同一名次上永远比字面命中少一半——只加分，不压过字面。
  graphRanked.forEach((h, i) => add(h.claimId, "graph", i, 0.5));

  const items: RecallItem[] = [...score.entries()]
    .map(([id, s]) => {
      const claim = byId.get(id)!;
      const ch = [...channels.get(id)!].sort();
      const viaGraph = ch.includes("graph");
      return {
        claim,
        channels: ch,
        // 「引导」= 字面与图路同时命中（最该放进上下文）；只有一路 ⇒ 「召回」。
        retrievalReasons: ch.length > 1 ? ["recall", "lead"] as FilterAction[] : ["recall"] as FilterAction[],
        score: s + TRI_STATE_BONUS[claim.triState] + intentBonus(input.query, claim.kind),
        graphPath: viaGraph ? graphBest.get(id)!.path : null,
      };
    })
    .sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id))
    .slice(0, input.limit);

  const hits = (ch: RecallChannel) => items.filter((i) => i.channels.includes(ch)).length;
  return {
    items,
    graphSeeds: seeds,
    plan: [
      { channel: "fts", weight: 1, hitCount: hits("fts"), available: true },
      { channel: "graph", weight: 0.5, hitCount: input.graph === null ? 0 : hits("graph"), available: input.graph !== null },
      { channel: "vector", weight: 0, hitCount: 0, available: false },
    ],
  };
}

/** 06-UX R5 的原话：图或向量不可用时对用户说的那一句。 */
export const RECALL_DEGRADED_NOTICE = "这次没能查全你的记忆（关联查询暂不可用），回答可能不完整";

const TRI_LABEL: Record<KG.KgTriState, string> = { pending: "AI 记下的", confirmed: "你确认过", conflict: "有矛盾" };

/**
 * 召回结果 → 交给模型的一段参考材料。没有命中 ⇒ null（不往上下文里塞空壳）。
 * 图路不可用时带上降级说明，让模型在回答里如实告诉用户「可能不完整」（R4-E1）。
 */
export function buildKnowledgeContextMessage(recall: KnowledgeRecall): string | null {
  const graphDown = recall.plan.some((p) => p.channel === "graph" && !p.available);
  if (recall.items.length === 0) return null;
  const lines = recall.items.map((i) => {
    const day = i.claim.saidAt === null ? null : i.claim.saidAt.slice(5, 10).replace("-", "/");
    // F12：个人空间（L1）的结论来自别的会话，要说清楚，模型才能在回答里标「来自个人空间知识」。
    const when = i.claim.scope === "personal"
      ? `（来自个人空间知识${day === null ? "" : `，最早见于你 ${day} 的对话`}）`
      : day === null ? "" : `（本会话 ${day} 的对话）`;
    return `- [${TRI_LABEL[i.claim.triState]}] ${i.claim.statement}${when}`;
  });
  return [
    "【记忆】以下是之前对话里记下的、与本轮问题相关的内容。「AI 记下的」尚未经用户确认，引用时要说明；「有矛盾」的两条都要提到；标了「来自个人空间知识」的，引用时也照样标出。",
    ...lines,
    ...(graphDown ? [`（${RECALL_DEGRADED_NOTICE}）`] : []),
  ].join("\n");
}
