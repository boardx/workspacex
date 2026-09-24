/**
 * Phase 18 F06 —— 抽取一轮：认领队列里的消息 → 模型抽候选 → 实体解析 → 交执行器（F03）。
 *
 * - 模型只提出（actor = model，status = proposed），落不落表由执行器裁决（I-3 / I-4 / I-5）。
 * - 幂等：批次带 `sourceRef = 消息 id` + 流水线版本，重复处理同一条消息，执行器原样返回（I-7）。
 * - 失败隔离：一条消息失败只让它自己稍后重试；一个 org 失败不影响别的 org。
 * - 消息发送从不等这里（06-UX R3-8「不拖慢对话」）：抽取在后台 worker 里跑。
 */
import type { LoggerPort } from "../ports/logger.port";
import { buildExtractionBatch } from "../../domain/knowledge-graph/extraction";
import { applyOntologyBatch } from "./apply-ontology-batch";
import type {
  KgExtractionJob, KgExtractionQueuePort, KgExtractionSourcePort, KnowledgeExtractorPort, OntologyStorePort,
} from "./ports";

/** 每个 org 每轮最多处理的消息数：模型调用是慢的，一个活跃的 org 不该让别的 org 等太久。 */
export const KG_EXTRACTION_BATCH = 5;
/** 模型看到的上文条数（不含本条）。 */
export const KG_EXTRACTION_CONTEXT_TURNS = 4;

export interface ExtractionDeps {
  readonly queue: KgExtractionQueuePort;
  readonly source: KgExtractionSourcePort;
  readonly extractor: KnowledgeExtractorPort;
  readonly store: OntologyStorePort;
  readonly logger: LoggerPort;
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

export interface ExtractionTickResult {
  readonly processed: number;
  readonly written: number;
  readonly failed: number;
}

export async function extractJob(deps: ExtractionDeps, job: KgExtractionJob): Promise<"written" | "empty"> {
  const loaded = await deps.source.loadMessage(job.orgId, job.messageId, KG_EXTRACTION_CONTEXT_TURNS);
  if (loaded === null) return "empty";  // 消息已被删：没有东西可抽
  const result = await deps.extractor.extract(loaded);
  const known = await deps.source.knownObjects(job.orgId, job.threadId);
  const batch = buildExtractionBatch({
    threadId: job.threadId, messageId: job.messageId, messageBody: loaded.message.body,
    result, known, newId: deps.newId,
  });
  if (batch === null) return "empty";
  const out = await applyOntologyBatch(deps.store, job.orgId, null, batch);
  if (out.outcome === "rejected") {
    // 执行器拒了（已留痕）：这是抽取产物的问题，重试同一份产物没有意义。
    deps.logger.info("kg extraction batch rejected", {
      traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, code: out.rejected.code,
    });
    return "empty";
  }
  return "written";
}

export async function runExtractionTick(deps: ExtractionDeps): Promise<ExtractionTickResult> {
  let processed = 0;
  let written = 0;
  let failed = 0;
  for (const orgId of await deps.queue.pendingOrgs()) {
    let jobs: readonly KgExtractionJob[];
    try {
      jobs = await deps.queue.claim(orgId, KG_EXTRACTION_BATCH);
    } catch (err) {
      deps.logger.error("kg extraction claim failed", { traceId: "kg-extraction", orgId, err });
      continue;
    }
    for (const job of jobs) {
      processed += 1;
      try {
        if ((await extractJob(deps, job)) === "written") written += 1;
        await deps.queue.complete(orgId, job.messageId);
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error("kg extraction failed", { traceId: "kg-extraction", orgId, messageId: job.messageId, attempts: job.attempts, err });
        await deps.queue.fail(orgId, job.messageId, message).catch(() => undefined);
      }
    }
  }
  return { processed, written, failed };
}
