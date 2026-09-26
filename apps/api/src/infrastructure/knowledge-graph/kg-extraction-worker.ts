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
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { newKgId } from "../../application/knowledge-graph/ids";
import { drainConflictCloses } from "../../application/knowledge-graph/detect-conflicts";
import { runExtractionTick, type ExtractionTickResult } from "../../application/knowledge-graph/extract-message-knowledge";
import {
  KG_CONFLICT_PORT, KG_EXTRACTION_QUEUE_PORT, KG_EXTRACTION_SOURCE_PORT, KNOWLEDGE_EXTRACTOR_PORT, ONTOLOGY_STORE_PORT,
  type KgConflictPort, type KgExtractionQueuePort, type KgExtractionSourcePort, type KnowledgeExtractorPort, type OntologyStorePort,
} from "../../application/knowledge-graph/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { KG_EXTRACTION_MODEL_CONFIG, type KgExtractionModelConfig } from "./kg-extraction-model-config";

export const KG_EXTRACTION_POLL_INTERVAL_MS = 2_000;

@Injectable()
export class KgExtractionWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(KG_EXTRACTION_MODEL_CONFIG) private readonly config: KgExtractionModelConfig,
    @Inject(KG_EXTRACTION_QUEUE_PORT) private readonly queue: KgExtractionQueuePort,
    @Inject(KG_EXTRACTION_SOURCE_PORT) private readonly source: KgExtractionSourcePort,
    @Inject(KNOWLEDGE_EXTRACTOR_PORT) private readonly extractor: KnowledgeExtractorPort,
    @Inject(ONTOLOGY_STORE_PORT) private readonly store: OntologyStorePort,
    @Inject(KG_CONFLICT_PORT) private readonly conflicts: KgConflictPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

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

  async runOnce(): Promise<ExtractionTickResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const tick = await runExtractionTick({
        queue: this.queue, source: this.source, extractor: this.extractor, store: this.store,
        conflicts: this.conflicts, logger: this.logger, newId: newKgId,
      });
      // F16：每一轮都排空「结束冲突」的待办（与有没有新消息无关）
      await drainConflictCloses({ conflicts: this.conflicts, logger: this.logger });
      return tick;
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("kg extraction poll failed", { traceId: "kg-extraction", err });
    }
  }
}
