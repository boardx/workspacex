/**
 * Phase 18 F06 —— 抽取结果的形状、容错解析、实体解析，以及把它变成一批执行器能收的候选。
 *
 * 全是纯函数：模型调用在基础设施层，落库在执行器（F03）。这里只回答两个问题——
 * 模型说的东西哪些可信到值得交给执行器；它说的「张三」是不是本会话里已有的那个「张三」。
 *
 * ## 为什么逐项丢弃而不是整批拒绝
 *
 * 模型偶尔会给出一个枚举外的类型、一条空结论。整批拒绝会让同一条消息里其余正确的内容一起丢掉，
 * 而用户看不到任何原因（06-UX R3-5：打扰要克制——抽取失败不出声）。所以坏项跳过、好项保留；
 * 枚举与长度的最终裁决仍在执行器与数据库 CHECK（两层都挡）。
 */
import { knowledgeGraph as KG, type projectEvidence as PE } from "@repo/contracts";
import { resolveTimeExpression } from "./claim-time";
import type { OntologyBatch, OntologyClaimInput, OntologyEdgeInput, OntologyEvidenceInput, OntologyObjectInput } from "./ontology-batch";

/** 幂等键的一半（I-7）。抽取逻辑（prompt / 解析 / 实体解析）改了就升版本：同一消息会按新版本重跑一次。 */
/** kg-extract@2（issue #4343）：prompt 与 schema 加了 goal / preference 两类。 */
/** kg-extract@3（issue #4363 S6）：结论带时间说法（timeExpr）⇒ 有效期（待办则是截止日期）。 */
export const KG_EXTRACTION_PIPELINE_VERSION = "kg-extract@3";

export interface ExtractedEntity {
  readonly name: string;
  readonly kind: KG.KgObjectKind;
  readonly aliases: readonly string[];
}

export interface ExtractedClaim {
  readonly statement: string;
  readonly kind: KG.KgClaimKind;
  readonly confidence: number;
  /** 这条结论涉及的实体名（须出现在 entities 里，否则忽略）。 */
  readonly about: readonly string[];
  /** 决定类结论的拍板人（人名，须是 entities 里的 person）。 */
  readonly decidedBy: string | null;
  /** 支撑它的原话（消息里的一段）；缺省用消息开头。 */
  readonly quote: string;
  /**
   * issue #4363（S6）：原话里限定这条结论**成立时段**（待办则是截止）的时间说法，原样摘录（「这周」「到年底」「下个月之前」）；
   * 没有 ⇒ null。换算成绝对时间在 claim-time.ts（按消息时间），不让模型算日期。
   */
  readonly timeExpr: string | null;
}

export interface ExtractionResult {
  readonly entities: readonly ExtractedEntity[];
  readonly claims: readonly ExtractedClaim[];
}

export const EMPTY_EXTRACTION: ExtractionResult = { entities: [], claims: [] };

const MAX_ENTITIES = 20;
const MAX_CLAIMS = 10;
const MAX_NAME = 200;
const MAX_STATEMENT = 500;
const MAX_EXCERPT = 280;
const MAX_TIME_EXPR = 40;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/**
 * 按**字符**截断（不是 UTF-16 码元）：`String.prototype.slice` 会把 emoji 这类代理对切成半个，
 * JSON 里留下孤立的 `\ud83d`，数据库 ::jsonb 直接拒收——那条消息就永远抽不成。
 */
export const clip = (s: string, max: number): string => Array.from(s).slice(0, max).join("");
const MAX_ALIASES = 10;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x) => x.length > 0) : []);

/** 解析模型输出（已是 JSON 值）。不认识的字段忽略，坏项丢弃，永不抛错。 */
export function parseExtraction(raw: unknown): ExtractionResult {
  if (typeof raw !== "object" || raw === null) return EMPTY_EXTRACTION;
  const r = raw as { entities?: unknown; claims?: unknown };
  const entities: ExtractedEntity[] = [];
  for (const e of Array.isArray(r.entities) ? r.entities : []) {
    const o = (e ?? {}) as Record<string, unknown>;
    const name = str(o.name);
    const kind = KG.KgObjectKind.safeParse(o.kind);
    if (name.length === 0 || name.length > MAX_NAME || !kind.success) continue;
    entities.push({ name, kind: kind.data, aliases: strs(o.aliases).filter((a) => a.length <= MAX_NAME && a !== name).slice(0, MAX_ALIASES) });
    if (entities.length >= MAX_ENTITIES) break;
  }
  const claims: ExtractedClaim[] = [];
  for (const c of Array.isArray(r.claims) ? r.claims : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const statement = str(o.statement);
    const kind = KG.KgClaimKind.safeParse(o.kind);
    if (statement.length === 0 || statement.length > MAX_STATEMENT || !kind.success) continue;
    const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0.5;
    const decidedBy = str(o.decidedBy ?? o.decided_by);
    const timeExpr = str(o.timeExpr ?? o.time_expr);
    claims.push({
      statement, kind: kind.data, confidence: conf, about: strs(o.about),
      decidedBy: decidedBy.length > 0 ? decidedBy : null, quote: str(o.quote),
      timeExpr: timeExpr.length > 0 && timeExpr.length <= MAX_TIME_EXPR ? timeExpr : null,
    });
    if (claims.length >= MAX_CLAIMS) break;
  }
  return { entities, claims };
}

/** 实体名归一：全角半角统一、去首尾空白、合并空白、不分大小写。 */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export interface KnownObject {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly kind: KG.KgObjectKind;
}

/**
 * 实体解析：同作用域里名字或别名（归一后）相同 ⇒ 同一个实体。
 * 优先同类型；类型不同但名字相同时也合并（模型常把同一家公司时而标 organization 时而标 product）。
 */
export function resolveEntity(e: ExtractedEntity, known: readonly KnownObject[]): KnownObject | null {
  const names = new Set([e.name, ...e.aliases].map(normalizeName));
  const hit = (k: KnownObject) => [k.name, ...k.aliases].some((n) => names.has(normalizeName(n)));
  return known.find((k) => k.kind === e.kind && hit(k)) ?? known.find(hit) ?? null;
}

export interface BuildExtractionBatchInput {
  readonly threadId: string;
  readonly messageId: string;
  readonly messageBody: string;
  /** issue #4363（S6）：这条消息的时间（ISO）——「这周」「到年底」按它换算。缺省 ⇒ 不带有效期。 */
  readonly messageAt?: string;
  readonly result: ExtractionResult;
  readonly known: readonly KnownObject[];
  /** 新 id 的来源（测试可注入确定序列）。 */
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

/**
 * issue #4363（S6）：时间说法 → 这条结论的时间字段。待办的时间说法是**截止日期**（过了截止更该提醒，不能当成过期不召回）；
 * 其余类别是**有效期**（「这周我在上海」过了这周就不再成立）。认不出的说法、没有消息时间 ⇒ 什么都不带（长期有效）。
 */
export function claimTime(
  c: Pick<ExtractedClaim, "kind" | "timeExpr">, messageAt: string | undefined,
): Pick<OntologyClaimInput, "validFrom" | "validUntil" | "dueAt"> {
  if (c.timeExpr === null || messageAt === undefined) return {};
  const range = resolveTimeExpression(c.timeExpr, new Date(messageAt));
  if (range === null) return {};
  return c.kind === "todo" ? { dueAt: range.until } : { validFrom: range.from, validUntil: range.until };
}

/**
 * 通用的「模型候选 → 执行器批次」（B3-T2 抽出来，chat 路径与项目证据路径共用，行为不变）：
 * 实体解析、结论落证据、about / decided_by 边——只有**批次落在哪个作用域、证据指向什么**由调用方给。
 */
export interface BuildCandidateBatchInput {
  readonly scope: OntologyBatch["scope"];
  readonly actionType: string;
  /** 幂等键的一半（消息 id / 证据单元 id）。 */
  readonly sourceRef: string;
  readonly pipelineVersion: string;
  /** 模型看到的原文：结论的摘录必须是它的一段，否则退回开头。 */
  readonly sourceText: string;
  /** 把一句摘录变成执行器认的证据项（消息证据 / 证据单元）。 */
  readonly evidenceFor: (excerpt: string) => OntologyEvidenceInput;
  readonly result: ExtractionResult;
  readonly known: readonly KnownObject[];
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
  /** issue #4363（S6）：原文的时间（ISO），时间说法按它换算；缺省 ⇒ 不带有效期 / 截止。 */
  readonly sourceAt?: string;
}

/** 没有任何结论也没有实体 ⇒ null（寒暄消息：什么都不写，也不报错）。 */
export function buildCandidateBatch(input: BuildCandidateBatchInput): OntologyBatch | null {
  const { result } = input;
  if (result.entities.length === 0 && result.claims.length === 0) return null;

  // 本批内的实体表：名字（含别名，归一后） → 实体 id。已知实体复用，新实体分配 id。
  const byName = new Map<string, { id: string; kind: KG.KgObjectKind }>();
  const known: KnownObject[] = [...input.known];
  const objects: OntologyObjectInput[] = [];
  for (const e of result.entities) {
    const existing = resolveEntity(e, known);
    let id: string;
    if (existing !== null) {
      id = existing.id;
    } else {
      id = input.newId("obj");
      objects.push({ id, objectKind: e.kind, name: e.name, aliases: e.aliases });
      known.push({ id, name: e.name, aliases: e.aliases, kind: e.kind });  // 同批内第二次出现时复用
    }
    for (const n of [e.name, ...e.aliases]) byName.set(normalizeName(n), { id, kind: existing?.kind ?? e.kind });
  }

  const claims: OntologyClaimInput[] = [];
  const edges: OntologyEdgeInput[] = [];
  // 模型给的原话不在原文里时，退回原文开头：它不一定就是支撑这条结论的那句，但一定是原话（执行器也会再核一遍）。
  const fallbackExcerpt = clip(input.sourceText, MAX_EXCERPT);
  for (const c of result.claims) {
    const id = input.newId("clm");
    const quote = c.quote.length > 0 && input.sourceText.includes(c.quote) ? clip(c.quote, MAX_EXCERPT) : fallbackExcerpt;
    claims.push({
      id, claimKind: c.kind, statement: c.statement, status: "proposed", confidence: c.confidence,
      evidence: [input.evidenceFor(quote)],
      ...claimTime(c, input.sourceAt),
    });
    const linked = new Set<string>();
    for (const name of c.about) {
      const target = byName.get(normalizeName(name));
      if (target === undefined || linked.has(target.id)) continue;
      linked.add(target.id);
      edges.push({ id: input.newId("edg"), srcKind: "claim", srcId: id, dstKind: "object", dstId: target.id, relation: "about" });
    }
    if (c.kind === "decision" && c.decidedBy !== null) {
      const who = byName.get(normalizeName(c.decidedBy));
      if (who !== undefined && who.kind === "person") {
        edges.push({ id: input.newId("edg"), srcKind: "claim", srcId: id, dstKind: "object", dstId: who.id, relation: "decided_by" });
      }
    }
  }

  return {
    actionId: input.newId("act"),
    scope: input.scope,
    actor: { kind: "model", id: "kg-extractor" },
    actionType: input.actionType,
    sourceRef: input.sourceRef,
    pipelineVersion: input.pipelineVersion,
    objects,
    claims,
    edges,
  };
}

/** chat 路径（F06）：会话作用域、消息证据。行为与抽出 `buildCandidateBatch` 之前逐字节相同。 */
export function buildExtractionBatch(input: BuildExtractionBatchInput): OntologyBatch | null {
  return buildCandidateBatch({
    scope: { kind: "chat_session", id: input.threadId },
    actionType: "extract",
    sourceRef: input.messageId,
    pipelineVersion: KG_EXTRACTION_PIPELINE_VERSION,
    sourceText: input.messageBody,
    evidenceFor: (excerpt) => ({ messageId: input.messageId, stance: "supporting", excerpt }),
    result: input.result,
    known: input.known,
    newId: input.newId,
    ...(input.messageAt === undefined ? {} : { sourceAt: input.messageAt }),
  });
}

/**
 * B3-T2：项目证据入图的幂等键另一半。与 chat 的 `KG_EXTRACTION_PIPELINE_VERSION` 分开计：
 * 同一条 chat 消息既可能作为会话消息被抽（sourceRef = 消息 id），也可能作为证据单元入项目大脑
 * （sourceRef = 证据单元 id `ev_…`），两条幂等键天然不撞；这里的版本只管项目路径。
 */
export const KG_PROJECT_INGESTION_PIPELINE_VERSION = "kg-project-ingest@1";
export const KG_PROJECT_INGESTION_ACTION_TYPE = "ingest_project_evidence";

export interface ProjectEvidenceForBatch {
  readonly id: string;
  readonly sourceKind: PE.ProjectEvidenceSourceKind;
  readonly sourceRef: string;
  readonly excerpt: string;
}

export interface BuildProjectEvidenceBatchInput {
  readonly projectId: string;
  readonly evidence: ProjectEvidenceForBatch;
  readonly result: ExtractionResult;
  readonly known: readonly KnownObject[];
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

/**
 * 项目路径（B3-T2）：project 作用域、证据单元锚点（sourceKind / sourceRef / evidenceId 都取自证据本身）。
 * 空结果 ⇒ null，与 chat 路径同一约定；调用方（`ingest-project-evidence.ts`）另行留痕以保证幂等。
 */
export function buildProjectEvidenceBatch(input: BuildProjectEvidenceBatchInput): OntologyBatch | null {
  const ev = input.evidence;
  return buildCandidateBatch({
    scope: { kind: "project", id: input.projectId },
    actionType: KG_PROJECT_INGESTION_ACTION_TYPE,
    sourceRef: ev.id,
    pipelineVersion: KG_PROJECT_INGESTION_PIPELINE_VERSION,
    sourceText: ev.excerpt,
    evidenceFor: (excerpt) => ({ evidenceId: ev.id, sourceKind: ev.sourceKind, sourceRef: ev.sourceRef, stance: "supporting", excerpt }),
    result: input.result,
    known: input.known,
    newId: input.newId,
  });
}
