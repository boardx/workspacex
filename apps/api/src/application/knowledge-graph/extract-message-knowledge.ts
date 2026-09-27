/**
 * Phase 18 F06 —— 抽取一轮：认领队列里的消息 → 模型抽候选 → 实体解析 → 交执行器（F03）。
 *
 * - 模型只提出（actor = model，status = proposed），落不落表由执行器裁决（I-3 / I-4 / I-5）。
 * - 幂等：批次带 `sourceRef = 消息 id` + 流水线版本，重复处理同一条消息，执行器原样返回（I-7）。
 * - 失败隔离：一条消息失败只让它自己稍后重试；一个 org 失败不影响别的 org。
 * - 消息发送从不等这里（06-UX R3-8「不拖慢对话」）：抽取在后台 worker 里跑。
 * - F16：交给执行器之后，同一个任务里接着判矛盾（detect-conflicts.ts）——任务完成之前卡已经开好。
 * - #4290：判完矛盾再判明确改口的取代（同一文件 detectSupersedes）——任务完成之前取代提示已经开好。
 * - issue #4283：判完取代，作者本人说的「决定」复制进作者本人的个人空间（auto-copy-decisions.ts）。
 * - round 7（#4284 收口）：项目会话里用过个人记忆的那一轮的 agent 回答不抽（见 extractJob）。
 */
import type { LoggerPort } from "../ports/logger.port";
import { buildExtractionBatch, KG_EXTRACTION_PIPELINE_VERSION } from "../../domain/knowledge-graph/extraction";
import { applyOntologyBatch } from "./apply-ontology-batch";
import { copyAuthorDecisions } from "./auto-copy-decisions";
import { proposeGoalLinks, type GoalLinkDeps } from "./profile";
import { detectConflicts, detectSupersedes } from "./detect-conflicts";
import type {
  KgAutoCopyPort, KgConflictPort, KgExtractionJob, KgExtractionQueuePort, KgExtractionSourcePort, KnowledgeExtractorPort, OntologyStorePort,
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
  readonly conflicts: KgConflictPort;
  /** issue #4283：必填——没有它就不该跑抽取（否则「本人的决定会自动记下」这件事会悄悄不发生）。 */
  readonly autoCopy: KgAutoCopyPort;
  /**
   * issue #4360：自动记入之后，模型提议把新记下的决定 / 待办挂到作者本人的哪个目标下（只有高把握才挂，见 profile.ts）。
   * 可选：没接（只测别的环节的构造点）⇒ 不挂，不影响抽取。
   */
  readonly goalLinks?: Pick<GoalLinkDeps, "goalLinks" | "proposer">;
  readonly logger: LoggerPort;
  readonly newId: (prefix: "obj" | "clm" | "edg" | "act") => string;
}

export interface ExtractionTickResult {
  readonly processed: number;
  readonly written: number;
  /** issue #4343：跑完了但没有可记的（含消息已删、执行器拒收）。processed = written + empty + skipped + failed。 */
  readonly empty: number;
  /** 按规则不抽的（round 7：项目会话里用了个人记忆的那一轮回答）。 */
  readonly skipped: number;
  readonly failed: number;
}

export async function extractJob(deps: ExtractionDeps, job: KgExtractionJob): Promise<"written" | "empty" | "skipped"> {
  const loaded = await deps.source.loadMessage(job.orgId, job.messageId, KG_EXTRACTION_CONTEXT_TURNS);
  if (loaded === null) {  // 消息已被删：没有东西可抽
    deps.logger.info("kg extraction empty", {
      traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, threadId: job.threadId, reason: "message_gone",
    });
    return "empty";
  }
  // round 7（#4284 收口）：项目会话里，agent 的回答若是在用了**提问者个人记忆**的那一轮写出来的，正文可能复述
  // 个人记忆；抽出来就成了全体成员可见、可召回的 chat_session 结论。这种回答不抽（任务照常完成、不重试），
  // 记一条日志说明原因。判定 fail closed：这一轮召回里只要有一条不能证明属于本会话的条目就跳过。个人会话不受影响。
  if (loaded.message.authorKind === "agent") {
    const outside = await deps.source.projectAnswerOutsideRecallCount(job.orgId, job.messageId);
    if (outside > 0) {
      deps.logger.info("kg extraction skipped: project-thread answer used personal memory", {
        traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, threadId: job.threadId, outsideRecallItems: outside,
      });
      return "skipped";
    }
  }
  const result = await deps.extractor.extract(loaded);
  const known = await deps.source.knownObjects(job.orgId, job.threadId);
  const batch = buildExtractionBatch({
    threadId: job.threadId, messageId: job.messageId, messageBody: loaded.message.body,
    result, known, newId: deps.newId,
  });
  if (batch === null) {
    // issue #4343 / #4350：「空」必须看得见——模型合法地回了「没有可记的」（或回的全被丢弃）；解析不出已经在
    // extractor 里抛错走重试。之前这里静默返回：「我的目标是探索未来教育」一条没记下，界面照样显示「已整理到最新」。
    deps.logger.info("kg extraction empty", {
      traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, threadId: job.threadId, reason: "no_candidates",
      authorKind: loaded.message.authorKind, pipelineVersion: KG_EXTRACTION_PIPELINE_VERSION,
      entities: result.entities.length, claims: result.claims.length,
    });
    return "empty";
  }
  const out = await applyOntologyBatch(deps.store, job.orgId, null, batch);
  if (out.outcome === "rejected") {
    // 执行器拒了（已留痕）：这是抽取产物的问题，重试同一份产物没有意义。
    deps.logger.info("kg extraction batch rejected", {
      traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, code: out.rejected.code,
    });
    return "empty";
  }
  // 去重命中（任务重试）也照样判：上一次可能在交执行器之后、判矛盾之前失败了。
  await detectConflicts({ conflicts: deps.conflicts, newId: deps.newId }, job);
  // #4290：明确改口的取代，接在判矛盾之后（见 detect-conflicts.ts detectSupersedes）
  await detectSupersedes({ conflicts: deps.conflicts, newId: deps.newId }, job);
  // 同理：重试时再跑一遍无害（已复制过的不再是候选）。判矛盾、取代之后跑：被标成冲突的新条不会被带进个人空间，
  // 被取代的旧条在复制之前已经定下来。
  await copyAuthorDecisions({ autoCopy: deps.autoCopy, logger: deps.logger, newId: deps.newId }, job);
  // issue #4360：挂目标只是锦上添花——出任何错都只记日志，这条消息照常算写成（不重试整条抽取）。
  if (deps.goalLinks !== undefined) {
    try {
      await proposeGoalLinks({ ...deps.goalLinks, logger: deps.logger, newId: deps.newId }, job);
    } catch (e) {
      deps.logger.info("kg goal link step failed", {
        traceId: "kg-extraction", orgId: job.orgId, messageId: job.messageId, detail: e instanceof Error ? e.message : "unexpected goal link failure",
      });
    }
  }
  return "written";
}

/**
 * issue #4350：`abandoned()` 为真 ⇒ 这一轮已被 worker 的 watchdog 放弃（下一轮已经可以开始）——不再认领新的
 * org 批次。已经认领到手的任务照常做完：它们还在自己的租约里，complete / fail 带着围栏令牌，迟到也不会动到
 * 别人重新认领的行。
 */
export async function runExtractionTick(deps: ExtractionDeps, abandoned: () => boolean = () => false): Promise<ExtractionTickResult> {
  let processed = 0;
  let written = 0;
  let empty = 0;
  let skipped = 0;
  let failed = 0;
  for (const orgId of await deps.queue.pendingOrgs()) {
    if (abandoned()) break;
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
        const outcome = await extractJob(deps, job);
        if (outcome === "written") written += 1;
        else if (outcome === "empty") empty += 1;
        else skipped += 1;
        await deps.queue.complete(orgId, job.messageId, job.attempts);
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error("kg extraction failed", { traceId: "kg-extraction", orgId, messageId: job.messageId, attempts: job.attempts, err });
        await deps.queue.fail(orgId, job.messageId, message, job.attempts).catch(() => undefined);
      }
    }
  }
  return { processed, written, empty, skipped, failed };
}
