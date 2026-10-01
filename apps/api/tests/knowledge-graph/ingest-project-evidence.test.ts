/**
 * 项目中枢 B3-T2（issue #4496）—— `ingestProjectEvidence`：按「AI 权限」读项目证据入图。
 * 纯 application 层（DB-free）：假证据端口 + 假 AI 设置仓储 + 假抽取器 + 内存执行器存储（按 I-7 键去重）。
 *
 * 钉住：允许集合过滤（六类 → 五开关反推）/ 无设置行 = 全部允许 / 幂等（留痕 + 执行器去重两层）/
 * 关掉来源后不再入图、已入图的保留 / 模型失败与执行器拒绝进 failures（sourceKind 用六类枚举）/
 * 只写 project 作用域（同一批次换成 org 作用域会被执行器校验拒掉）/ 全部关掉连取都不取。
 */
import { describe, expect, it } from "vitest";
import {
  allowedEvidenceKinds, ingestProjectEvidence, runProjectIngestionTick, toExtractionInput, type ProjectIngestionDeps,
} from "../../src/application/knowledge-graph/ingest-project-evidence";
import type { KgProjectIngestionPort, KnowledgeExtractorPort, OntologyStorePort, RejectedBatch } from "../../src/application/knowledge-graph/ports";
import type { ProjectAiSettingsRepository, ProjectAiSettingsRow, ProjectAiSourceKind } from "../../src/application/project/project-ai-settings-ports";
import type { ProjectEvidencePort, ProjectEvidenceRow, ProjectEvidenceSourceKind } from "../../src/application/project/project-evidence-ports";
import { guard } from "../../src/application/security/permission-filter";
import { buildExtractionBatch, KG_EXTRACTION_PIPELINE_VERSION, KG_PROJECT_INGESTION_PIPELINE_VERSION, type ExtractionResult } from "../../src/domain/knowledge-graph/extraction";
import { validateOntologyBatch, type OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-b3t2");
const PROJECT = "p-b3t2";
const ALL_SOURCES: readonly ProjectAiSourceKind[] = ["chat", "transcript", "survey", "interview", "research"];

const evidence = (id: string, sourceKind: ProjectEvidenceSourceKind, excerpt: string, over: Partial<ProjectEvidenceRow> = {}): ProjectEvidenceRow => ({
  id, projectId: PROJECT, sourceKind, resourceId: `res-${sourceKind}`, sourceRef: `ref-${id}`, excerpt, locator: {},
  speakerLabel: "王五", resourceTitle: "客户访谈 A", revoked: false, createdAt: "2026-09-27T00:00:00Z", ...over,
});

const NON_EMPTY: ExtractionResult = {
  entities: [{ name: "王五", kind: "person", aliases: [] }],
  claims: [{ statement: "王五决定先做德国", kind: "decision", confidence: 0.9, about: ["王五"], decidedBy: "王五", quote: "先做德国", timeExpr: null }],
};

/** 内存执行器存储：按 (sourceRef, pipelineVersion) 去重（I-7），记下每个送来的批次。 */
class FakeStore implements OntologyStorePort {
  readonly batches: OntologyBatch[] = [];
  readonly accepted = new Map<string, string>();
  readonly rejectedBatches: OntologyBatch[] = [];
  constructor(private readonly rejectWhen: (b: OntologyBatch) => RejectedBatch | null = () => null) {}
  async apply(_orgId: unknown, _user: string | null, batch: OntologyBatch) {
    this.batches.push(batch);
    const rejected = this.rejectWhen(batch);
    if (rejected !== null) return { rejected };
    const key = `${batch.sourceRef}|${batch.pipelineVersion}`;
    const existing = this.accepted.get(key);
    if (existing !== undefined) return { applied: { actionId: existing, deduplicated: true, objects: 0, claims: 0, edges: 0 } };
    this.accepted.set(key, batch.actionId);
    return { applied: { actionId: batch.actionId, deduplicated: false, objects: batch.objects.length, claims: batch.claims.length, edges: batch.edges.length } };
  }
  async recordRejected(_orgId: unknown, _user: string | null, batch: OntologyBatch) { this.rejectedBatches.push(batch); }
  /** 留痕口径与 PG 实现同一组键。 */
  ingestedIds(): Set<string> {
    return new Set([...this.accepted.keys()].filter((k) => k.endsWith(`|${KG_PROJECT_INGESTION_PIPELINE_VERSION}`)).map((k) => k.split("|")[0]!));
  }
}

interface Harness {
  readonly deps: ProjectIngestionDeps;
  readonly store: FakeStore;
  readonly listCalls: (readonly ProjectEvidenceSourceKind[])[];
  readonly extracted: string[];
  setSettings(row: ProjectAiSettingsRow | null): void;
  setEvidence(items: readonly ProjectEvidenceRow[]): void;
}

function harness(opts: {
  settings?: ProjectAiSettingsRow | null;
  items?: readonly ProjectEvidenceRow[];
  extract?: (ev: { readonly message: { readonly id: string } }) => Promise<ExtractionResult>;
  store?: FakeStore;
  pending?: readonly { orgId: typeof ORG; projectId: string }[];
} = {}): Harness {
  let settings = opts.settings ?? null;
  let items = opts.items ?? [];
  const listCalls: (readonly ProjectEvidenceSourceKind[])[] = [];
  const extracted: string[] = [];
  const store = opts.store ?? new FakeStore();
  const evidenceFake: Pick<ProjectEvidencePort, "listForIngestion"> = {
    listForIngestion: async (_org, projectId, kinds, limit) => {
      listCalls.push(kinds);
      return guard({ kind: "project", id: projectId }, items.filter((e) => !e.revoked && kinds.includes(e.sourceKind)).slice(0, limit));
    },
  };
  const evidencePort = evidenceFake as ProjectEvidencePort;
  const settingsFake: Pick<ProjectAiSettingsRepository, "find"> = {
    find: async (_org, projectId) => guard({ kind: "project", id: projectId }, settings),
  };
  const aiSettings = settingsFake as ProjectAiSettingsRepository;
  const ingestion: KgProjectIngestionPort = {
    pendingProjects: async () => opts.pending ?? [{ orgId: ORG, projectId: PROJECT }],
    alreadyIngested: async (_org, _project, ids) => new Set(ids.filter((id) => store.ingestedIds().has(id))),
    knownObjects: async (_org, projectId) => guard({ kind: "project", id: projectId }, []),
  };
  const extractor: KnowledgeExtractorPort = {
    extract: async (input) => { extracted.push(input.message.id); return (opts.extract ?? (async () => NON_EMPTY))(input); },
  };
  let n = 0;
  const logger = { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined } as unknown as ProjectIngestionDeps["logger"];
  return {
    deps: { evidence: evidencePort, aiSettings, ingestion, extractor, store, logger, newId: (p) => `${p}-${(n += 1)}` },
    store, listCalls, extracted,
    setSettings: (row) => { settings = row; },
    setEvidence: (next) => { items = next; },
  };
}

const settingsRow = (allowedSources: readonly ProjectAiSourceKind[]): ProjectAiSettingsRow => ({
  projectId: PROJECT, allowedSources, updatedAt: "2026-09-27T00:00:00Z", updatedBy: "u-fac",
});

describe("B3-T2 allowedEvidenceKinds：五开关 → 六类证据来源（映射只在契约一份）", () => {
  it("chat 开关同时放行 chat_message 与 attachment；其余一对一", () => {
    expect(allowedEvidenceKinds(["chat"])).toEqual(["chat_message", "attachment"]);
    expect(allowedEvidenceKinds(["survey", "interview"])).toEqual(["survey_response", "interview_segment"]);
    expect(allowedEvidenceKinds(ALL_SOURCES)).toEqual(["chat_message", "attachment", "survey_response", "interview_segment", "transcript_segment", "research_source"]);
    expect(allowedEvidenceKinds([])).toEqual([]);
  });
});

describe("B3-T2 ingestProjectEvidence", () => {
  it("允许集合过滤：只向仓储要允许的来源；批次落 project 作用域、锚点带证据的 sourceKind / sourceRef / evidenceId", async () => {
    const h = harness({
      settings: settingsRow(["survey", "interview"]),
      items: [evidence("ev-1", "survey_response", "先做德国"), evidence("ev-2", "transcript_segment", "先做意大利")],
    });
    const out = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.listCalls).toEqual([["survey_response", "interview_segment"]]);
    expect(h.extracted).toEqual(["ev-1"]);
    expect(out).toMatchObject({ processed: 1, written: 1, empty: 0, skipped: 0, failed: 0, failures: [] });
    const batch = h.store.batches[0]!;
    expect(batch.scope).toEqual({ kind: "project", id: PROJECT });
    expect(batch.actor).toEqual({ kind: "model", id: "kg-extractor" });
    expect(batch.sourceRef).toBe("ev-1");
    expect(batch.pipelineVersion).toBe(KG_PROJECT_INGESTION_PIPELINE_VERSION);
    expect(batch.claims[0]!.evidence).toEqual([{ evidenceId: "ev-1", sourceKind: "survey_response", sourceRef: "ref-ev-1", stance: "supporting", excerpt: "先做德国" }]);
    expect(batch.claims[0]!.status).toBe("proposed");
    // 同一批次交给执行器的纯校验（模型写 project 作用域 = 允许；I-4 只能 proposed）
    expect(validateOntologyBatch(batch, null)).toEqual({ ok: true });
  });

  it("无设置行 = 全部允许：全部来源都向仓储要（#4615 起七类，+ whiteboard_note）", async () => {
    const h = harness({ settings: null, items: [evidence("ev-1", "research_source", "先做德国")] });
    const out = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.listCalls[0]).toEqual(["chat_message", "attachment", "survey_response", "interview_segment", "transcript_segment", "research_source", "whiteboard_note"]);
    expect(out.written).toBe(1);
  });

  it("全部关掉：连仓储都不问，也不调模型", async () => {
    const h = harness({ settings: settingsRow([]), items: [evidence("ev-1", "survey_response", "先做德国")] });
    const out = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.listCalls).toEqual([]);
    expect(h.extracted).toEqual([]);
    expect(out).toMatchObject({ processed: 0, written: 0 });
  });

  it("幂等：同一证据第二轮不再调模型（留痕命中）；留痕缺失时执行器按 I-7 去重、计 skipped", async () => {
    const h = harness({ settings: null, items: [evidence("ev-1", "survey_response", "先做德国")] });
    await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    const second = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.extracted).toEqual(["ev-1"]);
    expect(second).toMatchObject({ processed: 0, skipped: 1, written: 0 });
    // 留痕口没告诉我们（比如另一个 worker 刚写完）⇒ 模型会再调一次，但执行器原样返回，不写第二份
    const noLedger = harness({ settings: null, items: [evidence("ev-1", "survey_response", "先做德国")], store: h.store });
    noLedger.deps.ingestion.alreadyIngested = async () => new Set();
    const third = await ingestProjectEvidence(noLedger.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(third).toMatchObject({ processed: 1, skipped: 1, written: 0 });
    expect(h.store.accepted.size).toBe(1);
  });

  it("模型合法地回空：写一条空留痕，下一轮不再送；计 empty", async () => {
    const h = harness({ settings: null, items: [evidence("ev-1", "interview_segment", "你好")], extract: async () => ({ entities: [], claims: [] }) });
    const first = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(first).toMatchObject({ processed: 1, empty: 1, written: 0 });
    const marker = h.store.batches[0]!;
    expect(marker).toMatchObject({ scope: { kind: "project", id: PROJECT }, sourceRef: "ev-1", objects: [], claims: [], edges: [] });
    const second = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(second).toMatchObject({ processed: 0, skipped: 1 });
    expect(h.extracted).toEqual(["ev-1"]);
  });

  it("关掉某来源后：不再入图，已入图结论保留；重新打开又能进", async () => {
    const h = harness({ settings: null, items: [evidence("ev-s", "survey_response", "先做德国"), evidence("ev-t", "transcript_segment", "先做意大利", { sourceRef: "seg-9" })] });
    await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.store.batches.map((b) => b.sourceRef)).toEqual(["ev-s", "ev-t"]);

    h.setSettings(settingsRow(["chat", "interview", "research"]));  // 关掉 survey 与 transcript
    h.setEvidence([evidence("ev-s", "survey_response", "先做德国"), evidence("ev-t", "transcript_segment", "先做意大利"), evidence("ev-s2", "survey_response", "预算 300 万")]);
    const closed = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.listCalls.at(-1)).toEqual(["chat_message", "attachment", "interview_segment", "research_source"]);
    expect(closed).toMatchObject({ processed: 0, written: 0 });
    expect(h.extracted).toEqual(["ev-s", "ev-t"]);  // ev-s2 没进模型
    // 已入图的两条结论仍在（撤销是人的动作，不是关开关的副作用）
    expect(h.store.accepted.size).toBe(2);

    h.setSettings(null);
    const reopened = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(reopened).toMatchObject({ processed: 1, written: 1, skipped: 2 });
    expect(h.extracted).toEqual(["ev-s", "ev-t", "ev-s2"]);
  });

  it("仓储回了不在允许集合里的来源（仓储 bug）⇒ 不送进模型（fail closed）", async () => {
    const h = harness({ settings: settingsRow(["survey"]), items: [] });
    h.deps.evidence.listForIngestion = async () => guard({ kind: "project", id: PROJECT }, [evidence("ev-x", "transcript_segment", "泄露")]);
    const out = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.extracted).toEqual([]);
    expect(out).toMatchObject({ processed: 0, skipped: 1 });
  });

  it("失败隔离：模型失败与执行器拒绝各进 failures（sourceKind 用六类枚举），其余证据照常入图", async () => {
    const store = new FakeStore((b) => (b.sourceRef === "ev-rej" ? { code: "KG_INVALID_BATCH", reason: "bad" } : null));
    const h = harness({
      settings: null, store,
      items: [evidence("ev-ok", "survey_response", "先做德国"), evidence("ev-boom", "interview_segment", "先做意大利"), evidence("ev-rej", "research_source", "先做法国")],
      extract: async ({ message }) => { if (message.id === "ev-boom") throw new Error("model down"); return NON_EMPTY; },
    });
    const out = await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(out).toMatchObject({ processed: 3, written: 1, failed: 2 });
    expect(out.failures).toEqual([
      { sourceKind: "interview_segment", sourceRef: "ref-ev-boom", reason: "model_unavailable" },
      { sourceKind: "research_source", sourceRef: "ref-ev-rej", reason: "rejected_by_executor" },
    ]);
    expect(store.rejectedBatches.map((b) => b.sourceRef)).toEqual(["ev-rej"]);
    // 失败的两条没有留痕：下一轮还会再试
    expect(store.ingestedIds()).toEqual(new Set(["ev-ok"]));
  });

  it("非 project 作用域不走这条：入图批次一律 project；同样的批次换成 org 作用域被执行器校验拒掉（模型不能写组织层）", async () => {
    const h = harness({ settings: null, items: [evidence("ev-1", "survey_response", "先做德国"), evidence("ev-2", "attachment", "预算 300 万", { sourceRef: "ver-1" })] });
    await ingestProjectEvidence(h.deps, { orgId: ORG, projectId: PROJECT, limit: 5 });
    expect(h.store.batches.map((b) => b.scope.kind)).toEqual(["project", "project"]);
    const asOrg: OntologyBatch = { ...h.store.batches[0]!, scope: { kind: "org", id: ORG } };
    expect(validateOntologyBatch(asOrg, null)).toMatchObject({ ok: false, code: "KG_ACTOR_NOT_HUMAN" });
    // chat 路径不受影响：仍是会话作用域 + 消息证据 + 自己的流水线版本
    const chat = buildExtractionBatch({ threadId: "t1", messageId: "m1", messageBody: "先做德国", result: NON_EMPTY, known: [], newId: (p) => `${p}-c` });
    expect(chat).toMatchObject({ scope: { kind: "chat_session", id: "t1" }, actionType: "extract", sourceRef: "m1", pipelineVersion: KG_EXTRACTION_PIPELINE_VERSION });
    expect(chat!.claims[0]!.evidence).toEqual([{ messageId: "m1", stance: "supporting", excerpt: "先做德国" }]);
  });

  it("模型输入：正文就是摘录，材料标题与发言人作为上文；匿名答卷没有发言人", () => {
    const withSpeaker = toExtractionInput(evidence("ev-1", "interview_segment", "先做德国"));
    expect(withSpeaker.message).toEqual({ id: "ev-1", threadId: "res-interview_segment", body: "先做德国", authorKind: "human" });
    expect(withSpeaker.context.map((c) => c.body)).toEqual(["（来自「客户访谈 A」，王五 说）"]);
    const anonymous = toExtractionInput(evidence("ev-2", "survey_response", "预算 300 万", { speakerLabel: null, resourceTitle: "Q3 问卷" }));
    expect(anonymous.context.map((c) => c.body)).toEqual(["（来自「Q3 问卷」）"]);
  });

  it("runProjectIngestionTick：逐项目跑，一个项目抛错不影响别的项目；abandoned 后不再开始新项目", async () => {
    const h = harness({
      settings: null, items: [evidence("ev-1", "survey_response", "先做德国")],
      pending: [{ orgId: ORG, projectId: "p-broken" }, { orgId: ORG, projectId: PROJECT }, { orgId: ORG, projectId: "p-late" }],
    });
    const find = h.deps.aiSettings.find;
    h.deps.aiSettings.find = async (org, projectId) => { if (projectId === "p-broken") throw new Error("db down"); return find(org, projectId); };
    let calls = 0;
    const tick = await runProjectIngestionTick(h.deps, () => (calls += 1) > 2);
    expect(tick).toMatchObject({ projects: 2, written: 1, failed: 1 });
    expect(h.extracted).toEqual(["ev-1"]);
  });
});
