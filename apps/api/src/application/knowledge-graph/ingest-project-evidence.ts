/**
 * 项目中枢 B3-T2（issue #4496）—— 抽取器按「AI 权限」读项目证据入图。
 *
 * 一轮（一个项目）：
 *   读 `project_ai_settings`（无行 = 全部允许，`toProjectAiSettingsOutput` 是这条默认值的唯一说明处）
 *   → 用 `PROJECT_EVIDENCE_TO_AI_SOURCE` 反推**允许的证据来源集合**（六类 → 五个开关，映射只在契约里一份）
 *   → `ProjectEvidencePort.listForIngestion(orgId, projectId, kinds, limit)`
 *   → 每条证据走 chat 路径同一个模型调用（`KnowledgeExtractorPort.extract`）与同一个组批函数
 *     （`buildCandidateBatch`，B3-T2 从 `buildExtractionBatch` 抽出，chat 路径行为不变）
 *   → `applyOntologyBatch` 写 **project 作用域**（actor = model，只能 proposed，I-4），锚点带证据的
 *     sourceKind / sourceRef / evidenceId。
 *
 * ## 为什么这里可以 `discloseDecided`——内容只进模型，不进人眼
 *
 * `listForIngestion` 与 `ProjectAiSettingsRepository.find` 都回 `Guarded<…>`：它们是租户数据。本任务没有登录用户，
 * 以**项目主体自己**的身份披露（`projectIngestionDecision`）：证据在这里的唯一去向是模型的输入，模型的产物落进
 * **同一个项目**的作用域，之后任何人要看到它都必须经 `getProjectKnowledge` 按查看者逐次 `authorize(read.published)`
 * ——也就是说，这一步没有把任何内容从「项目成员可见」搬到别的可见范围。允许与否**不是**由这个决策定的，而是由
 * 设置页「AI 权限」定的：来源不在允许集合里，连 `listForIngestion` 都不会去取（仓储按 sourceKind 过滤，判定在这里）。
 * 这与 F02 的判定对象不同（不是「某个人能不能看」），所以不走 `authorize`，而是把「为什么允许」写成一条可回溯的决策。
 *
 * ## 幂等：同一证据不重复入图
 *
 * 批次 `sourceRef = 证据单元 id`、`pipelineVersion = KG_PROJECT_INGESTION_PIPELINE_VERSION`，执行器按 I-7 去重
 * （`ontology_actions` 唯一索引）。模型合法地回「没有可记的」时也**写一条空批次留痕**——否则这条证据永远
 * 「尚未被任何结论引用」，每轮都会被重新送进模型。轮初先用 `alreadyIngested` 把留过痕的剔掉，省掉模型调用。
 * （更干净的做法是证据表加 `ingested_at`，见回报；那需要 T1 的表改形状，先用动作表。）
 *
 * ## 关掉某来源之后
 *
 * 不再入图（不在允许集合里就不取）；已入图的结论**保留**（它们仍是真实说过的话，撤销是人的动作）；面板按
 * AI 设置把这些锚点标成「来源已关闭」（`project-brain-panel.tsx` 本地推导，契约不改）。
 *
 * ## 失败隔离
 *
 * 一条证据模型失败只让它自己这轮不进（下一轮 `listForIngestion` 还会给它）；进 `failures`，`sourceKind` 用六类枚举。
 * 一个项目失败不影响别的项目（`runProjectIngestionTick`）。
 */
import { knowledgeGraph as KG, projectEvidence as PE } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import {
  buildProjectEvidenceBatch, KG_PROJECT_INGESTION_ACTION_TYPE, KG_PROJECT_INGESTION_PIPELINE_VERSION, type KnownObject,
} from "../../domain/knowledge-graph/extraction";
import type { OntologyBatch } from "../../domain/knowledge-graph/ontology-batch";
import type { LoggerPort } from "../ports/logger.port";
import type { ProjectAiSettingsRepository, ProjectAiSourceKind } from "../project/project-ai-settings-ports";
import { toProjectAiSettingsOutput } from "../project/get-project-ai-settings";
import type { ProjectEvidencePort, ProjectEvidenceRow, ProjectEvidenceSourceKind } from "../project/project-evidence-ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { applyOntologyBatch } from "./apply-ontology-batch";
import type { KgMessage, KgProjectIngestionPort, KnowledgeExtractorPort, OntologyStorePort } from "./ports";

/** 每个项目每轮最多送进模型的证据条数（同 `KG_EXTRACTION_BATCH` 的理由：一个活跃项目不该让别的项目等太久）。 */
export const KG_PROJECT_INGESTION_BATCH = 5;

export type ProjectIngestionFailure = z.infer<typeof KG.KgIngestionSummary>["failures"][number];

export interface ProjectIngestionDeps {
  readonly evidence: ProjectEvidencePort;
  readonly aiSettings: ProjectAiSettingsRepository;
  readonly ingestion: KgProjectIngestionPort;
  readonly extractor: KnowledgeExtractorPort;
  readonly store: OntologyStorePort;
  readonly logger: LoggerPort;
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

export interface IngestProjectEvidenceInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly limit: number;
}

export interface ProjectIngestionResult {
  /** 送进模型的条数。processed = written + empty + failed。 */
  readonly processed: number;
  readonly written: number;
  /** 模型合法地回了空（已留痕，不会再送）。 */
  readonly empty: number;
  /** 没送进模型的：已留过痕（幂等命中）、或仓储回了不在允许集合里的来源。 */
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly ProjectIngestionFailure[];
}

const EMPTY_RESULT: ProjectIngestionResult = { processed: 0, written: 0, empty: 0, skipped: 0, failed: 0, failures: [] };

/**
 * 设置页五个开关 → 允许进入项目大脑的证据来源（六类）。映射只在契约 `PROJECT_EVIDENCE_TO_AI_SOURCE` 一份，
 * 这里只是按它过滤；顺序取契约枚举的声明顺序。
 */
export function allowedEvidenceKinds(allowedSources: readonly ProjectAiSourceKind[]): readonly ProjectEvidenceSourceKind[] {
  const allowed = new Set<ProjectAiSourceKind>(allowedSources);
  return PE.ProjectEvidenceSourceKind.options.filter((k) => allowed.has(PE.PROJECT_EVIDENCE_TO_AI_SOURCE[k]));
}

/**
 * 入图任务披露证据用的决策（见文件头「为什么这里可以 discloseDecided」）。两层都 `role: null, passed: true`：
 * 没有人在读——这不是某个人的角色让它过，而是「项目主体读自己的证据、产物留在同一项目」这条规则让它过。
 * `decisionId` 带项目 id，日志 / 留痕里能回溯到是哪个项目的哪次入图。
 */
export function projectIngestionDecision(projectId: string): PermissionDecision {
  return {
    allowed: true,
    orgLayer: { role: null, teamId: null, passed: true },
    projectLayer: { role: null, groupId: null, passed: true },
    scopeLayer: { scope: "org-wide", passed: true },
    reasonCode: null,
    decisionId: `kg-project-ingest:${projectId}`,
  };
}

/**
 * 证据单元 → 抽取器的输入。正文就是摘录（≤ 280 字）：结论的摘录必须是它的一段（执行器再核一遍）。
 * 材料标题与发言人作为一条上文给模型（消解「我们」「这个方案」这类指代、把发言人解析成 person 实体）——
 * 它不是要抽的那条消息，抽取器只对 `message` 抽。
 */
export function toExtractionInput(ev: ProjectEvidenceRow): { readonly message: KgMessage; readonly context: readonly KgMessage[] } {
  const message: KgMessage = { id: ev.id, threadId: ev.resourceId, body: ev.excerpt, authorKind: "human" };
  const who = ev.speakerLabel === null ? "" : `，${ev.speakerLabel} 说`;
  const context: KgMessage[] = ev.resourceTitle.trim() === "" && who === ""
    ? []
    : [{ id: `${ev.id}:ctx`, threadId: ev.resourceId, body: `（来自「${ev.resourceTitle}」${who}）`, authorKind: "human" }];
  return { message, context };
}

/** 模型回空时的留痕批次：没有实体 / 结论 / 边，只为让 `(sourceRef, pipelineVersion)` 在动作表里有一条 accepted。 */
function emptyMarkerBatch(projectId: string, ev: ProjectEvidenceRow, newId: ProjectIngestionDeps["newId"]): OntologyBatch {
  return {
    actionId: newId("act"),
    scope: { kind: "project", id: projectId },
    actor: { kind: "model", id: "kg-extractor" },
    actionType: KG_PROJECT_INGESTION_ACTION_TYPE,
    sourceRef: ev.id,
    pipelineVersion: KG_PROJECT_INGESTION_PIPELINE_VERSION,
    objects: [], claims: [], edges: [],
  };
}

export async function ingestProjectEvidence(deps: ProjectIngestionDeps, input: IngestProjectEvidenceInput): Promise<ProjectIngestionResult> {
  const { orgId, projectId } = input;
  const log = { traceId: "kg-project-ingestion", orgId, projectId };
  const decision = projectIngestionDecision(projectId);

  const settings = discloseDecided(await deps.aiSettings.find(orgId, projectId), decision);
  if (!isDisclosed(settings)) return EMPTY_RESULT;  // 决策恒 allowed，理论不可达；留着让「未经决策的载荷」拿不出来
  const kinds = allowedEvidenceKinds(toProjectAiSettingsOutput(projectId, settings.payload).allowedSources);
  if (kinds.length === 0) return EMPTY_RESULT;  // 全部关掉：连取都不取

  const listed = discloseDecided(await deps.evidence.listForIngestion(orgId, projectId, kinds, input.limit), decision);
  if (!isDisclosed(listed)) return EMPTY_RESULT;
  if (listed.payload.length === 0) return EMPTY_RESULT;

  const allowed = new Set<ProjectEvidenceSourceKind>(kinds);
  const done = await deps.ingestion.alreadyIngested(orgId, projectId, listed.payload.map((e) => e.id));
  // 项目作用域已有的实体（同一决策披露：它们只进实体解析）；本轮新写的实体追加进去，下一条证据里同名的复用。
  const knownDisclosed = discloseDecided(await deps.ingestion.knownObjects(orgId, projectId), decision);
  const known: KnownObject[] = isDisclosed(knownDisclosed) ? [...knownDisclosed.payload] : [];

  let processed = 0; let written = 0; let empty = 0; let skipped = 0; let failed = 0;
  const failures: ProjectIngestionFailure[] = [];
  for (const ev of listed.payload) {
    if (!allowed.has(ev.sourceKind)) {
      // 仓储只该回允许集合里的来源；回了别的就是仓储的 bug——不送进模型（fail closed），记下来。
      deps.logger.error("kg project ingestion: repository returned a restricted source kind", {
        ...log, evidenceId: ev.id, sourceKind: ev.sourceKind, err: new Error(`restricted source kind ${ev.sourceKind} returned by listForIngestion`),
      });
      skipped += 1;
      continue;
    }
    if (done.has(ev.id)) { skipped += 1; continue; }
    processed += 1;
    let result;
    try {
      result = await deps.extractor.extract(toExtractionInput(ev));
    } catch (err) {
      failed += 1;
      failures.push({ sourceKind: ev.sourceKind, sourceRef: ev.sourceRef, reason: "model_unavailable" });
      deps.logger.error("kg project ingestion failed", { ...log, evidenceId: ev.id, sourceKind: ev.sourceKind, err });
      continue;
    }
    const batch = buildProjectEvidenceBatch({ projectId, evidence: ev, result, known, newId: deps.newId })
      ?? emptyMarkerBatch(projectId, ev, deps.newId);
    const out = await applyOntologyBatch(deps.store, orgId, null, batch);
    if (out.outcome === "rejected") {
      // 执行器拒了（已留痕）：这是抽取产物的问题，重送同一份产物没有意义；下一轮 alreadyIngested 不含它（rejected 不算），
      // 但 listForIngestion 会再给——与 chat 路径一样，由模型下一次的产物决定。
      failed += 1;
      failures.push({ sourceKind: ev.sourceKind, sourceRef: ev.sourceRef, reason: "rejected_by_executor" });
      deps.logger.info("kg project ingestion batch rejected", { ...log, evidenceId: ev.id, code: out.rejected.code });
      continue;
    }
    if (out.applied.deduplicated) { skipped += 1; continue; }
    if (batch.claims.length === 0 && batch.objects.length === 0) {
      empty += 1;
      deps.logger.info("kg project ingestion empty", { ...log, evidenceId: ev.id, sourceKind: ev.sourceKind, reason: "no_candidates" });
      continue;
    }
    written += 1;
    for (const o of batch.objects) known.push({ id: o.id, name: o.name, aliases: o.aliases, kind: o.objectKind });
  }
  return { processed, written, empty, skipped, failed, failures };
}

export interface ProjectIngestionTickResult extends ProjectIngestionResult {
  readonly projects: number;
}

/**
 * 一轮：对每个待处理项目跑 `ingestProjectEvidence`（每项目 ≤ `KG_PROJECT_INGESTION_BATCH` 条）。
 * `abandoned()` 为真（worker watchdog 已放弃这一轮）⇒ 不再开始新的项目；一个项目抛错只记日志，不影响别的项目。
 */
export async function runProjectIngestionTick(deps: ProjectIngestionDeps, abandoned: () => boolean = () => false): Promise<ProjectIngestionTickResult> {
  let projects = 0;
  const sum = { processed: 0, written: 0, empty: 0, skipped: 0, failed: 0 };
  const failures: ProjectIngestionFailure[] = [];
  for (const { orgId, projectId } of await deps.ingestion.pendingProjects()) {
    if (abandoned()) break;
    projects += 1;
    try {
      const r = await ingestProjectEvidence(deps, { orgId, projectId, limit: KG_PROJECT_INGESTION_BATCH });
      sum.processed += r.processed; sum.written += r.written; sum.empty += r.empty; sum.skipped += r.skipped; sum.failed += r.failed;
      failures.push(...r.failures);
    } catch (err) {
      sum.failed += 1;
      deps.logger.error("kg project ingestion tick failed for project", { traceId: "kg-project-ingestion", orgId, projectId, err });
    }
  }
  return { projects, ...sum, failures };
}
