/**
 * Phase 18 F06 —— 抽取 worker：每 2 秒认领一批新消息做知识抽取。
 *
 * 骨架同 kg-projection-worker（`setInterval(...).unref()` + `running` 防重入）。部署没能力
 * （没配置模型，或没设 KG_EXTRACTION_ENABLED=1）时不启动轮询。
 *
 * ⚠ 2026-09-25 更正（issue #4178）：这里曾经写着「队列照样排，打开后补抽」——那是**假的**。
 *   触发器 `kg_enqueue_extraction`（迁移 20260924210000，issue #4178 起加了第二道闸门）在
 *   部署没能力、或该组织没打开抽取时，直接 `RETURN NULL` 丢弃这条消息，从不写进
 *   `kg_extraction_queue`。也就是说：抽取关着期间发的消息，**永远不会被补抽**——之后打开
 *   （不管是部署装上了模型，还是组织 admin 在组织后台把开关打开）只对**打开之后新发的消息**
 *   生效，旧的那些没有第二次机会进队列。要把关着期间的历史消息补进来，只有「整理本会话」
 *   那条路（uc-18-3 A1，`requestReindex`），不是等它自己排上。
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
    if (!this.config.enabled) return;
    // 先告诉数据库「抽取开着」，触发器才开始给新消息排队；失败只记日志，下一次启动再试。
    void this.queue.enable().catch((err) => this.logger.error("kg extraction enable failed", { traceId: "kg-extraction", err }));
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
