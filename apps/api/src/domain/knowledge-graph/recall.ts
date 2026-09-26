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
import { decisionLike, DECISION_RECALL_LIMIT } from "./decision-claim";
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
  /**
   * 这条结论对这一轮来说属于哪里：本会话（L0）或本人个人空间（F12 的 L1，以及 F15 起本人其他个人对话里记下的——
   * 「个人空间 = 同一用户全部个人线程」S0-2=A，06-UX R2 M1「开新会话不用重新交代背景」）。
   */
  readonly scope: "chat_session" | "personal";
  /** 记在本人另一个个人对话里（不是本会话、也不是长期记忆）⇒ 那个对话的 id；其余 ⇒ 省略。 */
  readonly originThreadId?: string;
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

/**
 * 三态与查询意图只作**并列时的次序**（tie-breaker）：量级远小于任何两个相邻 RRF 名次之差
 * （候选集内最小的名次差约 1e-5），所以不会改变字面 / 图路给出的名次，只在分数相同时决定先后。
 */
const TRI_STATE_BONUS: Record<KG.KgTriState, number> = { confirmed: 2e-7, pending: 0, conflict: -1e-7 };

/**
 * 查询意图（query-planned，同 domain/retrieval/channel-plan.ts 的思路）：问「谁定的 / 谁拍板」时，
 * 并列的结论里决定类优先（事实、风险在后）。同样只是并列时的次序。
 */
const WHO_DECIDED = /谁|哪位|拍板|决定|who|decid/i;
function intentBonus(query: string, kind: KG.KgClaimKind): number {
  return WHO_DECIDED.test(query) && kind === "decision" ? 3e-7 : 0;
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

/** 排好序的列表里第 i 项的竞争名次：与前面同分的项共用最前那一项的名次。 */
function sharedRank<T>(sorted: readonly T[], i: number, key: (x: T) => number): number {
  let r = i;
  while (r > 0 && key(sorted[r - 1]!) === key(sorted[i]!)) r -= 1;
  return r;
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
  const lexScore = new Map(lexical.map((x) => [x.c.id, x.s]));

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
  // 同分同名次（竞争排名）：分数相同的两条拿到同一个 RRF 名次，谁先谁后留给三态 / 意图去定，
  // 不由 id 的字典序偷偷决定。
  lexical.forEach((x, i) => add(x.c.id, "fts", sharedRank(lexical, i, (y) => y.s), 1));
  // 图路权重 0.5：同一名次上永远比字面命中少一半——只加分，不压过字面。
  graphRanked.forEach((h, i) => add(h.claimId, "graph", sharedRank(graphRanked, i, (y) => y.path.length), 0.5));

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
    // 图路只加分（R7-2）：有字面命中的一律排在只有图路命中的前面；字面命中的之间先比字面分，图路只在字面分相同的
    // 几条之间抬名次（F15 评测 E5.c2 量出来：刚改过的一条还没投影进图，一个人人都提到的实体——「北极星项目」——
    // 给其余几十条都加了图路分，字面最贴切的那条反被挤出前 8）。
    .sort((a, b) => Number(b.channels.includes("fts")) - Number(a.channels.includes("fts"))
      || (lexScore.get(b.claim.id) ?? 0) - (lexScore.get(a.claim.id) ?? 0)
      || b.score - a.score || a.claim.id.localeCompare(b.claim.id))
    .slice(0, input.limit);

  // Ad-hoc（issue #4181）：本会话内「决定类」结论，不管字面/图路打分有多低，都额外强制带上——
  // 一句「我决定关注 211 高校」这样的约束性决定，只有后续问题恰好带关键词才会被上面的排序选中；
  // 用户说「开始写报告吧」不会命中，等于决定在对话变长后失效，即使它理应一直生效（issue 原始报告）。
  //
  // 三条边界，都是这一轮特意收窄的范围（人类签核前的默认实现，见 signoff-draft 的新开放问题）：
  //   1. **只认本会话（不含跨会话 / 长期记忆）**：`scope === "chat_session" && originThreadId === undefined`
  //      精确对应「这条结论记在当前这个会话里」（cross-thread 的 F15 结论会带 originThreadId，L1 长期记忆的
  //      结论 scope 是 "personal"）——跨会话是否也要享受这条规则，留给 F15 跨会话召回一起裁决（issue 原文）。
  //   2. **只挑活的**：`input.claims` 本身已经是 `candidates()` 查出来的活结论（`revoked_at IS NULL AND
  //      status <> 'superseded'`），撤销 / 被取代的结论从不会出现在这里，不需要在这个纯函数里再判一次。
  //   3. **额外名额，不占用 `KG_RECALL_LIMIT`**：issue 里两种方案都要人确认，这里先按「倾向额外加」实现
  //      （决定类通常很短，见 issue），已经在上面按 `input.limit`（=`KG_RECALL_LIMIT`）截断的 `items` 之外
  //      再加最多 `DECISION_RECALL_LIMIT`（3）条——已经在 `items` 里的（正常打分就挤进了前 `limit`）不重复
  //      加一份；超过上限时按结论最早证据时间（`saidAt`，没有就排最后）取最新的几条，同上面「决定类优先」
  //      的直觉一致：越新的决定越可能仍然有效。
  const forcedIds = new Set(items.map((i) => i.claim.id));
  const decisionForced: RecallItem[] = input.claims
    .filter((c) => !forcedIds.has(c.id) && c.scope === "chat_session" && c.originThreadId === undefined && decisionLike(c.statement))
    .sort((a, b) => (b.saidAt ?? "").localeCompare(a.saidAt ?? "") || a.id.localeCompare(b.id))
    .slice(0, DECISION_RECALL_LIMIT)
    .map((claim) => ({
      claim,
      // "claim" 通道本来就是给「已复核的结论 / 决定」用的（见 `domain/retrieval/channel-plan.ts` 同名通道的注释），
      // 语义上正合适；不复用 fts/graph，这样界面 / 日志能一眼看出这条不是靠打分挤进来的。
      channels: ["claim"] as RecallChannel[],
      retrievalReasons: ["recall"] as FilterAction[],
      // 不是打分进来的：分数记 0，「强制」由 claim 通道表达。**不能是 Infinity**——它要写进
      // `kg_turn_recalls.items`（jsonb），JSON 会把 Infinity 变成 null，读接口回 `score: null` 违反契约
      // `KgRecalledMemory.score: z.number()`，前端解析失败、整轮回答下方（引用 / 确认卡）都不画（issue #4271）。
      score: 0,
      graphPath: null,
    }));

  const allItems = [...items, ...decisionForced];
  const hits = (ch: RecallChannel) => allItems.filter((i) => i.channels.includes(ch)).length;
  return {
    items: allItems,
    graphSeeds: seeds,
    plan: [
      { channel: "fts", weight: 1, hitCount: hits("fts"), available: true },
      { channel: "graph", weight: 0.5, hitCount: input.graph === null ? 0 : hits("graph"), available: input.graph !== null },
      { channel: "vector", weight: 0, hitCount: 0, available: false },
      // 决定类强制召回不是一路真正的检索通道（不排序、不参与融合），但同样需要不静默：这里如实报告
      // 命中了几条，供 F13 的回执与测试观察，不需要「不可用」这种降级状态（纯函数，不会失败）。
      { channel: "claim", weight: 0, hitCount: decisionForced.length, available: true },
    ],
  };
}

/** 06-UX R5 的原话：图或向量不可用时对用户说的那一句。 */
export const RECALL_DEGRADED_NOTICE = "这次没能查全你的记忆（关联查询暂不可用），回答可能不完整";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const TRI_LABEL: Record<KG.KgTriState, string> = { pending: "AI 记下的", confirmed: "你确认过", conflict: "有矛盾" };

/**
 * 召回结果 → 交给模型的一段参考材料。没有命中 ⇒ null（不往上下文里塞空壳）。
 * 图路不可用时带上降级说明，让模型在回答里如实告诉用户「可能不完整」（R4-E1）。
 */
export function buildKnowledgeContextMessage(recall: KnowledgeRecall): string | null {
  // 图路只在「问题里有已知实体」时才会执行；它执行失败 ⇒ plan 里 graph.available = false。
  const graphDown = recall.plan.some((p) => p.channel === "graph" && !p.available);
  // 一条也没召回到：图路正常 ⇒ 不塞空壳；图路坏了 ⇒ 仍要告诉模型「可能不完整」，不静默降级（R4-E1）。
  if (recall.items.length === 0) return graphDown ? `【记忆】（${RECALL_DEGRADED_NOTICE}）` : null;
  const lines = recall.items.map((i) => {
    const day = i.claim.saidAt === null ? null : i.claim.saidAt.slice(5, 10).replace("-", "/");
    // F12：个人空间（L1）的结论来自别的会话，要说清楚，模型才能在回答里标「来自个人空间知识」。
    const when = i.claim.scope === "personal"
      ? `（来自个人空间知识${day === null ? "" : `，最早见于你 ${day} 的对话`}）`
      : day === null ? "" : `（本会话 ${day} 的对话）`;
    // 结论原文进上下文前压成一行：原文里的换行不能伪造出材料里的其他行（降级说明、「系统：」之类）。
    return `- [${TRI_LABEL[i.claim.triState]}] ${oneLine(i.claim.statement)}${when}`;
  });
  return [
    "【记忆】以下是之前对话里记下的、与本轮问题相关的内容。「AI 记下的」尚未经用户确认，引用时要说明；「有矛盾」的两条都要提到；标了「来自个人空间知识」的，引用时也照样标出。",
    ...lines,
    ...(graphDown ? [`（${RECALL_DEGRADED_NOTICE}）`] : []),
  ].join("\n");
}
