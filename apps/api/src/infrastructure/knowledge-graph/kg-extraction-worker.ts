/**
 * Phase 18 F06 —— 抽取 worker：每 2 秒认领一批新消息做知识抽取。
 *
 * 骨架同 kg-projection-worker（`setInterval(...).unref()` + `running` 防重入）。
 *
 * ⚠ 用户直接交办更正（2026-09-25，ad-hoc）：轮询是否启动，现在只看**部署有没有配置模型
 *   provider**（`this.config.enabled`），不再看"部署开关"（`kg_extraction_state.enabled`，
 *   已落库、平台管理员随时可切换，见 `KgDeploymentExtractionSettingsPort` 头注）——原因很
 *   直接：轮询一个空的/被闸门拦住的队列很便宜（2 秒一次单条带索引的查询），而触发器
 *   `kg_enqueue_extraction` 本身已经在查这两个开关，开关关着时新消息压根不会被排进
 *   `kg_extraction_queue`，轮询到的永远是空集。让轮询独立于这个随时可能被翻转的开关，
 *   换来的是：管理员刚把开关打开，不需要等进程重启，下一次 2 秒轮询就能捞到新排进来的
 *   消息——这正是这次改动要解决的问题（开关本身不该要求重启才能生效）。
 *
 *   启动时**不再**调 `queue.enable()`（`kg_extraction_enable()`，只能 false → true 的单向
 *   开关）——那是旧设计"进程一启动、发现自己配了模型，就把部署开关焊死成开"的行为，与
 *   "部署开关是平台管理员随时可切换的独立状态"这个新语义直接冲突：进程重启不该悄悄把
 *   管理员刚关掉的开关重新打开。没有 provider 时也不主动把开关拨成 false——没有 provider
 *   本身已经能保证不会跑抽取（这个 worker 压根不轮询，`ModelKnowledgeExtractor` 也没有
 *   provider 可用），拨动一个平台管理员自己维护的开关不是这个 worker 的职责，不然又是
 *   "进程启动改动了一个应该只由人改的状态"的老问题换了个方向重演。
 *
 * ⚠ 2026-09-25 更正（issue #4178，本次改动前就成立，原样保留）：这里曾经写着「队列照样
 *   排，打开后补抽」——那是**假的**。触发器 `kg_enqueue_extraction`（迁移 20260924210000，
 *   issue #4178 起加了组织那道闸门，本次改动前是两道，现在部署那道从「启动参数」变成
 *   「落库随时可切换」，闸门数量不变）在任何一道没开时直接 `RETURN NULL` 丢弃这条消息，
 *   从不写进 `kg_extraction_queue`。也就是说：抽取关着期间发的消息，**永远不会被补抽**——
 *   之后打开只对**打开之后新发的消息**生效，旧的那些没有第二次机会进队列。要把关着期间
 *   的历史消息补进来，只有「整理本会话」那条路（uc-18-3 A1，`requestReindex`），不是等它
 *   自己排上。
 */
import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { newKgId } from "../../application/knowledge-graph/ids";
import { drainConflictCloses } from "../../application/knowledge-graph/detect-conflicts";
import { runExtractionTick, type ExtractionTickResult } from "../../application/knowledge-graph/extract-message-knowledge";
import type { WorthinessModelPort } from "../../application/knowledge-graph/extraction-gate";
import { KG_EXTRACTION_SLO_RECORDER, type ExtractionSloRecorder } from "../../application/knowledge-graph/extraction-slo-recorder";
import {
  KG_EXTRACTION_GATE_MODEL, KG_EXTRACTION_SLO_COUNTS_PORT, KG_EXTRACTION_SLO_THRESHOLDS, type KgExtractionSloCountsPort,
} from "../../application/knowledge-graph/s8-ports";
import { EXTRACTION_SLO_DEFAULTS, type ExtractionSloThresholds } from "../../domain/knowledge-graph/extraction-slo";
import {
  KG_AUTO_COPY_PORT, KG_CONFLICT_PORT, KG_EXTRACTION_QUEUE_PORT, KG_EXTRACTION_SOURCE_PORT, KNOWLEDGE_EXTRACTOR_PORT, ONTOLOGY_STORE_PORT,
  type KgAutoCopyPort, type KgConflictPort, type KgExtractionQueuePort, type KgExtractionSourcePort, type KnowledgeExtractorPort, type OntologyStorePort,
} from "../../application/knowledge-graph/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { KG_GOAL_LINK_PORT, KG_GOAL_LINK_PROPOSER_PORT, type GoalLinkPort, type GoalLinkProposerPort } from "../../application/knowledge-graph/profile-ports";
import { KG_EXTRACTION_MODEL_CONFIG, type KgExtractionModelConfig } from "./kg-extraction-model-config";
import { KG_EXTRACTION_LEASE_SECONDS } from "./pg-kg-extraction";

export const KG_EXTRACTION_POLL_INTERVAL_MS = 2_000;

/** 注入令牌：一轮 tick 的 watchdog 上限（毫秒）。不注入 ⇒ `kgExtractionWatchdogMs(process.env)`。测试用它压短。 */
export const KG_EXTRACTION_WATCHDOG_MS = Symbol("KgExtractionWatchdogMs");
/** 模型超时之外再留的余量：认领、读消息、落执行器、判矛盾这些库操作。 */
export const KG_EXTRACTION_WATCHDOG_MARGIN_MS = 60_000;
/** S8（#4365）：SLO 判定的最小间隔（每次要数一次全库卡住的租约）。 */
export const KG_EXTRACTION_SLO_CHECK_INTERVAL_MS = 60_000;

/**
 * issue #4350 —— 一轮 tick 最多等多久就放弃它、让下一轮能开始。
 *
 * 取 max(租约, 模型超时 + 余量)：
 * - 租约（300 秒）到期之后，这一轮手里没做完的行本来就会被重新认领——再把 `running` 攥着不放，只是让
 *   **所有 org** 陪着这一个卡住的 await 一起停摆（devapp 2026-09-27「整理中」永远不动的原因之一）；
 * - 但一次模型调用合法地可以跑满 `KERNEL_MODEL_TIMEOUT_MS`（默认 180 秒，#1611 起可以配到 300 秒以上），
 *   上限不能比它短，否则一个慢而正常的调用会被当成卡死。
 */
export function kgExtractionWatchdogMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.KERNEL_MODEL_TIMEOUT_MS ?? "180000");
  const modelTimeout = Number.isFinite(raw) && raw > 0 ? raw : 180_000;
  return Math.max(KG_EXTRACTION_LEASE_SECONDS * 1_000, modelTimeout + KG_EXTRACTION_WATCHDOG_MARGIN_MS);
}

@Injectable()
export class KgExtractionWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly watchdogMs: number;
  private lastSloCheck = 0;
  /** 上一次判定超标的指标集合（按名字排序拼接）；只在集合变化时记日志，不每分钟刷屏。 */
  private sloBreach = "";

  constructor(
    @Inject(KG_EXTRACTION_MODEL_CONFIG) private readonly config: KgExtractionModelConfig,
    @Inject(KG_EXTRACTION_QUEUE_PORT) private readonly queue: KgExtractionQueuePort,
    @Inject(KG_EXTRACTION_SOURCE_PORT) private readonly source: KgExtractionSourcePort,
    @Inject(KNOWLEDGE_EXTRACTOR_PORT) private readonly extractor: KnowledgeExtractorPort,
    @Inject(ONTOLOGY_STORE_PORT) private readonly store: OntologyStorePort,
    @Inject(KG_CONFLICT_PORT) private readonly conflicts: KgConflictPort,
    @Inject(KG_AUTO_COPY_PORT) private readonly autoCopy: KgAutoCopyPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Optional() @Inject(KG_EXTRACTION_WATCHDOG_MS) watchdogMs?: number,
    /** S8：以下四个生产合成必注入；只测 watchdog 的构造点可以不给（那时不计数、不判 SLO，门控规则照常生效）。 */
    @Optional() @Inject(KG_EXTRACTION_SLO_RECORDER) private readonly slo?: ExtractionSloRecorder,
    @Optional() @Inject(KG_EXTRACTION_SLO_COUNTS_PORT) private readonly sloCounts?: KgExtractionSloCountsPort,
    @Optional() @Inject(KG_EXTRACTION_SLO_THRESHOLDS) private readonly sloThresholds?: ExtractionSloThresholds,
    @Optional() @Inject(KG_EXTRACTION_GATE_MODEL) private readonly gateModel?: WorthinessModelPort | null,
    /** issue #4360：新记下的决定 / 待办挂到本人目标下（模型提议、高把握才挂）。生产合成必定注入。 */
    @Optional() @Inject(KG_GOAL_LINK_PORT) private readonly goalLinks?: GoalLinkPort,
    @Optional() @Inject(KG_GOAL_LINK_PROPOSER_PORT) private readonly goalProposer?: GoalLinkProposerPort,
  ) {
    this.watchdogMs = watchdogMs ?? kgExtractionWatchdogMs();
  }

  onModuleInit(): void {
    // 只看"有没有配置模型 provider"；部署开关（`kg_extraction_state`）不再在启动时被
    // 这个 worker 碰——它现在是平台管理员随时可切换的独立状态，见本文件头注。
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.poll(), KG_EXTRACTION_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 跑一轮。上一轮还没结束 ⇒ null（不重入）。
   *
   * issue #4350 watchdog：这一轮超过 `watchdogMs` 还没结束 ⇒ 记一条 error、放弃等待、释放 `running`，返回 null——
   * 以前一个永不 settle 的 await（模型 / 连接池卡住）会让 `running` 永远是 true，**所有 org** 的抽取从此停摆。
   *
   * 被放弃的那一轮如果后来又动起来，不会重复完成任何行：
   * 1. 它不再认领新的 org 批次（`runExtractionTick` 的 `abandoned()` 检查）；
   * 2. 它手里已认领的行还在自己的租约里（`locked_at` 活着），下一轮的认领条件跳过它们，不会有两个人同时做同一行；
   * 3. 租约过期后那一行可能被下一轮重新认领（attempts + 1）——这时旧任务迟到的 complete / fail 带着自己认领时的
   *    attempts 作围栏令牌（`pg-kg-extraction.ts` 的 complete / fail），对不上就什么都不改：删不掉、也解不开新认领的行；
   * 4. 两边都跑到了执行器那一步也无害：批次带 `sourceRef = 消息 id` + 流水线版本，执行器按 I-7 幂等原样返回。
   * 被放弃的 promise 之后的失败只记日志，不会成为未处理的 rejection。
   */
  async runOnce(): Promise<ExtractionTickResult | null> {
    if (this.running) return null;
    this.running = true;
    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const work = (async () => {
      const tick = await runExtractionTick({
        queue: this.queue, source: this.source, extractor: this.extractor, store: this.store,
        conflicts: this.conflicts, autoCopy: this.autoCopy, logger: this.logger, newId: newKgId,
        ...(this.slo !== undefined ? { slo: this.slo } : {}),
        ...(this.gateModel !== undefined && this.gateModel !== null ? { gateModel: this.gateModel } : {}),
        ...(this.goalLinks !== undefined && this.goalProposer !== undefined ? { goalLinks: { goalLinks: this.goalLinks, proposer: this.goalProposer } } : {}),
      }, () => abandoned);
      // issue #4343：有处理过消息的一轮留一条计数，「跑了但一条没记下」（empty）与「没跑」（没有这行）分得开。
      if (tick.processed > 0) this.logger.info("kg extraction tick", { traceId: "kg-extraction", ...tick });
      // F16：每一轮都排空「结束冲突」的待办（与有没有新消息无关）
      if (!abandoned) await drainConflictCloses({ conflicts: this.conflicts, logger: this.logger });
      return tick;
    })();
    const watchdog = new Promise<"watchdog">((resolve) => {
      timer = setTimeout(() => resolve("watchdog"), this.watchdogMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([work, watchdog]);
      if (outcome !== "watchdog") return outcome;
      abandoned = true;
      this.logger.error("kg extraction tick exceeded watchdog; abandoned so the next tick can run", {
        traceId: "kg-extraction", watchdogMs: this.watchdogMs, elapsedMs: Date.now() - startedAt,
        err: new Error(`kg_extraction_tick_watchdog (${this.watchdogMs}ms)`),
      });
      work.then(
        () => this.logger.info("abandoned kg extraction tick settled late", { traceId: "kg-extraction", elapsedMs: Date.now() - startedAt }),
        (err: unknown) => this.logger.error("abandoned kg extraction tick failed", { traceId: "kg-extraction", err }),
      );
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.running = false;
    }
  }

  /**
   * S8（#4365）：SLO 判定。超标的指标集合**变化**时记一条：进入 / 变化 ⇒ error（「kg extraction slo breached」，带
   * 指标、值、阈值），恢复 ⇒ info。管理页的横幅读同一个判定（PlatformMemoryOpsController）。`force` 给测试用。
   */
  async checkSlo(force = false): Promise<void> {
    if (this.slo === undefined || this.sloCounts === undefined) return;
    const now = Date.now();
    if (!force && now - this.lastSloCheck < KG_EXTRACTION_SLO_CHECK_INTERVAL_MS) return;
    this.lastSloCheck = now;
    const { stuckLeases } = await this.sloCounts.counts();
    const alerts = this.slo.evaluate(stuckLeases, this.sloThresholds ?? EXTRACTION_SLO_DEFAULTS);
    const key = alerts.map((a) => a.metric).sort().join(",");
    if (key === this.sloBreach) return;
    this.sloBreach = key;
    if (alerts.length > 0) {
      this.logger.error("kg extraction slo breached", {
        traceId: "kg-extraction-slo", code: "KG_EXTRACTION_SLO_BREACHED", alerts,
        err: new Error(`kg_extraction_slo_breached (${key})`),
      });
    } else {
      this.logger.info("kg extraction slo recovered", { traceId: "kg-extraction-slo" });
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("kg extraction poll failed", { traceId: "kg-extraction", err });
    }
    try {
      await this.checkSlo();
    } catch (err) {
      this.logger.error("kg extraction slo check failed", { traceId: "kg-extraction-slo", err });
    }
  }
}
