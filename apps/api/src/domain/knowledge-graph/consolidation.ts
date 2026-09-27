/**
 * Phase 18 S8（#4365，epic #4359）—— 个人空间的记忆整合：判哪些结论是同一句话说了两遍、哪些实体是同一个东西的
 * 两种写法、哪些结论彼此矛盾。纯函数：只出「计划」，落不落表、怎么撤销在数据库函数 `kg_consolidation_apply` /
 * `kg_consolidation_undo`（迁移 20260928180000）。
 *
 * ## 宁可漏合，不可错合（同 conflict.ts「宁可漏，不可误」）
 *
 * 错合的代价：两条本来不同的记忆变成一条，被合掉的那条从召回里消失。所以每一种合并都要**同时**过几道门：
 *
 * 结论去重（`claim_merge`）——同一个人个人空间里、都活着、类型相同，且
 *   1. 数值集合完全相同（「预算 50 万」与「预算 60 万」永远不合——那是矛盾，走下面的冲突卡）；
 *   2. 否定极性相同（「我喜欢咖啡」与「我不喜欢咖啡」字面几乎一样，不能合）；
 *   3. 涉及的实体集合相同（实体按本次合一换成保留方之后）；
 *   4. **内容词完全相同**（#4491 评审 H2）：去掉虚词后的相邻两字、拉丁整词、数字，两边的对称差必须为空——
 *      「负责人是张三」对「负责人是李四」、「在上海举办」对「在北京举办」、「用Python写」对「用Go写」字面与向量都很像，
 *      但多出 / 少了一个内容词，一律不合（那是另一件事或矛盾，不是重复）。只差虚词（「的」「一点」「都」）才算同一句话；
 *   5. 以下之一：
 *      - 归一后文本相同（NFKC、去空白标点、小写）；
 *      - 有 S9 的向量且余弦 ≥ `CONSOLIDATION_COSINE_MIN`，**并且**字面相似（相邻两字 Dice）≥ `CONSOLIDATION_LEXICAL_WITH_VECTOR_MIN`；
 *      - 没有向量（嵌入没配置 / 还没嵌完）时，只认字面相似 ≥ `CONSOLIDATION_LEXICAL_ONLY_MIN`。
 *   已在冲突中（contested）的不参与：那一对等人裁决，整合不替人选。
 *
 * 实体合一（`entity_merge`）——同一个人个人空间里、都未被合并、类型相同，且归一名相同，或一方的归一名是另一方的别名。
 *
 * 矛盾（`conflict`）——复用 F16 的判定 `isConflict`（同一组实体、同一指标、不同数值），实体名先按本次合一换成保留方的名字。
 * 只开卡，不裁决（R3 D2「不自动裁决」）：卡由人选「以新的为准 / 两条都留 / 忽略」。
 *
 * 保留谁：有人确认过的（reviewed）优先，其次最早的，最后按 id——同样的输入永远得到同样的计划。
 */
import { isConflict, numberTokens, type ConflictClaimKind } from "./conflict";
import { normalizeName } from "./extraction";

/** 向量余弦下限（S9 嵌入）。保守：同义改写通常 ≥ 0.9，「同一话题的两件事」常落在 0.8–0.9。 */
export const CONSOLIDATION_COSINE_MIN = 0.92;
/** 有向量时的字面相似下限：向量说「很像」之外，还要字面上确实是同一句话的改写。 */
export const CONSOLIDATION_LEXICAL_WITH_VECTOR_MIN = 0.6;
/** 没有向量时只靠字面：几乎逐字相同才合。 */
export const CONSOLIDATION_LEXICAL_ONLY_MIN = 0.9;
/** 一次整合每人最多处理的结论数（取最近的）：计划是 O(n²) 的两两比较，量大时分几轮。 */
export const CONSOLIDATION_MAX_CLAIMS = 400;

export interface ConsolidationClaim {
  readonly id: string;
  readonly kind: ConflictClaimKind;
  readonly statement: string;
  readonly status: "proposed" | "reviewed" | "accepted" | "contested";
  /** 有人确认过（reviewed_by 非空）。 */
  readonly reviewed: boolean;
  readonly createdAt: string;
  /** 涉及的实体 id（活的 about 边）。 */
  readonly aboutObjectIds: readonly string[];
}

export interface ConsolidationObject {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly createdAt: string;
}

/** 数据库按 S9 向量算好的一对（只给同类型、两边都有同一模型向量的；a < b）。 */
export interface SimilarClaimPair {
  readonly a: string;
  readonly b: string;
  readonly cosine: number;
}

export type ClaimMergeBasis = "exact" | "semantic" | "lexical";

export interface ClaimMergePlan {
  readonly keepId: string;
  readonly mergeId: string;
  readonly basis: ClaimMergeBasis;
  /** 余弦（semantic）或字面相似度（lexical / exact = 1）。 */
  readonly score: number;
}

export interface EntityMergePlan {
  readonly keepId: string;
  readonly mergeId: string;
}

export interface ConflictPlan {
  readonly newerId: string;
  readonly olderId: string;
}

/** 撤销过的一对（无序）。 */
export interface UndonePair {
  readonly a: string;
  readonly b: string;
}
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export interface ConsolidationPlan {
  readonly claimMerges: readonly ClaimMergePlan[];
  readonly entityMerges: readonly EntityMergePlan[];
  readonly conflicts: readonly ConflictPlan[];
}

const NOISE = /[\s\p{P}\p{S}]+/gu;
/** 归一文本：NFKC、小写、去掉空白与标点符号。 */
export function statementKey(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(NOISE, "");
}

/** 虚词 / 程度词：去掉它们不改变一句话说的是什么（「简洁的回答」=「简洁一点的回答」）。宁可少列：列多了会把内容词当虚词。 */
const FUNCTION_CHARS = /[的地得了着过是在和与及也都就还很更最太又再才吧呢啊呀吗么哦嘛一点些个把被给对]/gu;
const HAN_RUN = /\p{Script=Han}+/gu;
const LATIN_WORD = /[a-z][a-z0-9+#.]*/g;
const DIGITS = /\d+(?:[./:-]\d+)*/g;

/** 内容词：去掉虚词后的汉字相邻两字（单字段按单字）、拉丁整词、数字串。 */
export function contentTokens(statement: string): Set<string> {
  const text = statement.normalize("NFKC").toLowerCase();
  const out = new Set<string>();
  for (const run of text.match(HAN_RUN) ?? []) {
    const core = [...run.replace(FUNCTION_CHARS, "")];
    if (core.length === 1) out.add(core[0]!);
    for (let i = 0; i + 1 < core.length; i += 1) out.add(core[i]! + core[i + 1]!);
  }
  for (const w of text.replace(HAN_RUN, " ").match(LATIN_WORD) ?? []) out.add(`w:${w}`);
  for (const d of text.match(DIGITS) ?? []) out.add(`n:${d}`);
  return out;
}

/** 相邻两字（bigram）的 Dice 系数，0–1。一个字的串按单字算。 */
export function lexicalSimilarity(a: string, b: string): number {
  const ka = statementKey(a);
  const kb = statementKey(b);
  if (ka === kb) return 1;
  const grams = (s: string) => {
    const chars = [...s];
    const out = new Map<string, number>();
    if (chars.length === 1) out.set(chars[0]!, 1);
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const g = chars[i]! + chars[i + 1]!;
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(ka);
  const gb = grams(kb);
  let total = 0;
  let shared = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

const NEGATION = /不|没|别|未|非|无|莫|勿|\bnot\b|\bno\b|\bnever\b|n't/gi;
function negationCount(s: string): number {
  return (s.normalize("NFKC").match(NEGATION) ?? []).length;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** 两条结论能不能当成同一句话（见文件头）。返回合并依据，不能合 ⇒ null。 */
export function duplicateBasis(
  a: ConsolidationClaim, b: ConsolidationClaim, cosine: number | null,
  /** 实体 id → 合一后的保留方 id（没有合一 ⇒ 原样）。 */
  canonicalObject: (id: string) => string = (id) => id,
): { basis: ClaimMergeBasis; score: number } | null {
  if (a.id === b.id || a.kind !== b.kind) return null;
  if (a.status === "contested" || b.status === "contested") return null;
  if (!sameSet(numberTokens(a.statement), numberTokens(b.statement))) return null;
  if (negationCount(a.statement) !== negationCount(b.statement)) return null;
  if (!sameSet(new Set(a.aboutObjectIds.map(canonicalObject)), new Set(b.aboutObjectIds.map(canonicalObject)))) return null;
  if (statementKey(a.statement) === statementKey(b.statement)) return { basis: "exact", score: 1 };
  if (!sameSet(contentTokens(a.statement), contentTokens(b.statement))) return null;
  const lexical = lexicalSimilarity(a.statement, b.statement);
  if (cosine !== null) {
    return cosine >= CONSOLIDATION_COSINE_MIN && lexical >= CONSOLIDATION_LEXICAL_WITH_VECTOR_MIN
      ? { basis: "semantic", score: cosine } : null;
  }
  return lexical >= CONSOLIDATION_LEXICAL_ONLY_MIN ? { basis: "lexical", score: lexical } : null;
}

function keeperOrder<T extends { readonly id: string; readonly createdAt: string }>(
  reviewed: (x: T) => boolean,
): (x: T, y: T) => number {
  return (x, y) => Number(reviewed(y)) - Number(reviewed(x))
    || (Date.parse(x.createdAt) || 0) - (Date.parse(y.createdAt) || 0)
    || x.id.localeCompare(y.id);
}

/** 并查集分组。链式相似（A≈B≈C）会落进同一组；结论去重只合与保留方直接过了门的那几条（见 planConsolidation）。 */
function groups<T extends { readonly id: string }>(items: readonly T[], edges: readonly [string, string][]): T[][] {
  const parent = new Map(items.map((x) => [x.id, x.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const out = new Map<string, T[]>();
  for (const x of items) out.set(find(x.id), [...(out.get(find(x.id)) ?? []), x]);
  return [...out.values()].filter((g) => g.length > 1);
}

/** 实体归一键：名字与别名，NFKC、小写、去空白与标点。 */
function entityKeys(o: ConsolidationObject): { name: string; all: Set<string> } {
  const name = statementKey(normalizeName(o.name));
  return { name, all: new Set([name, ...o.aliases.map((a) => statementKey(normalizeName(a)))].filter((k) => k.length > 0)) };
}

export function planEntityMerges(objects: readonly ConsolidationObject[]): EntityMergePlan[] {
  const edges: [string, string][] = [];
  const keys = new Map(objects.map((o) => [o.id, entityKeys(o)]));
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const a = objects[i]!;
      const b = objects[j]!;
      if (a.kind !== b.kind) continue;
      const ka = keys.get(a.id)!;
      const kb = keys.get(b.id)!;
      if (ka.name.length === 0 || kb.name.length === 0) continue;
      if (ka.name === kb.name || kb.all.has(ka.name) || ka.all.has(kb.name)) edges.push([a.id, b.id]);
    }
  }
  const out: EntityMergePlan[] = [];
  for (const g of groups(objects, edges)) {
    const [keep, ...rest] = [...g].sort(keeperOrder<ConsolidationObject>(() => false));
    for (const m of rest) out.push({ keepId: keep!.id, mergeId: m.id });
  }
  return out;
}

export function planConsolidation(input: {
  readonly claims: readonly ConsolidationClaim[];
  readonly objects: readonly ConsolidationObject[];
  readonly similar: readonly SimilarClaimPair[];
  /** #4491 H1：本人撤销过的那几对（结论对 / 实体对 / 矛盾对，无序）——撤销要「粘住」，之后的整合不再动它们。 */
  readonly undone?: readonly UndonePair[];
}): ConsolidationPlan {
  const undone = new Set((input.undone ?? []).map((p) => pairKey(p.a, p.b)));
  const entityMerges = planEntityMerges(input.objects).filter((m) => !undone.has(pairKey(m.keepId, m.mergeId)));
  const keeperOfObject = new Map(entityMerges.map((e) => [e.mergeId, e.keepId]));
  const canonicalObject = (id: string) => keeperOfObject.get(id) ?? id;
  const cosineOf = new Map(input.similar.map((p) => [p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`, p.cosine]));
  const claims = [...input.claims].sort((x, y) => x.id.localeCompare(y.id));

  const edges: [string, string][] = [];
  const bases = new Map<string, { basis: ClaimMergeBasis; score: number }>();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i]!;
      const b = claims[j]!;
      if (undone.has(pairKey(a.id, b.id))) continue;
      const verdict = duplicateBasis(a, b, cosineOf.get(`${a.id}|${b.id}`) ?? null, canonicalObject);
      if (verdict === null) continue;
      edges.push([a.id, b.id]);
      bases.set(`${a.id}|${b.id}`, verdict);
    }
  }
  const claimMerges: ClaimMergePlan[] = [];
  const merged = new Set<string>();
  for (const g of groups(claims, edges)) {
    const [keep, ...rest] = [...g].sort(keeperOrder<ConsolidationClaim>((c) => c.reviewed));
    for (const m of rest) {
      const key = keep!.id < m.id ? `${keep!.id}|${m.id}` : `${m.id}|${keep!.id}`;
      // 链式分组（A≈B≈C）里保留方与这一条未必直接相似：只合直接过了门的，其余留着（宁可漏合）。
      const basis = bases.get(key);
      if (basis === undefined) continue;
      claimMerges.push({ keepId: keep!.id, mergeId: m.id, ...basis });
      merged.add(m.id);
    }
  }

  // 矛盾：在合并之后还活着的结论之间判；实体名按合一后的保留方算。
  const nameOf = new Map(input.objects.map((o) => [o.id, o.name]));
  const about = (c: ConsolidationClaim) => [...new Set(c.aboutObjectIds.map((id) => nameOf.get(canonicalObject(id)) ?? id))];
  const live = claims.filter((c) => !merged.has(c.id));
  const conflicts: ConflictPlan[] = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const [older, newer] = [live[i]!, live[j]!].sort(keeperOrder<ConsolidationClaim>(() => false));
      if (older!.status === "contested" || newer!.status === "contested") continue;
      if (undone.has(pairKey(older!.id, newer!.id))) continue;
      const hit = isConflict(
        { id: newer!.id, kind: newer!.kind, statement: newer!.statement, confidence: 1, about: about(newer!) },
        { id: older!.id, kind: older!.kind, statement: older!.statement, about: about(older!), scope: "personal", confirmedAt: older!.createdAt },
      );
      if (hit) conflicts.push({ newerId: newer!.id, olderId: older!.id });
    }
  }
  return { claimMerges, entityMerges, conflicts };
}
