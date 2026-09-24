/**
 * Phase 18 F06 —— 抽取 worker：每 2 秒认领一批新消息做知识抽取。
 *
 * 骨架同 kg-projection-worker（`setInterval(...).unref()` + `running` 防重入）。抽取没开（没配置模型，
 * 或没设 KG_EXTRACTION_ENABLED=1）时不启动——队列照样排，打开后补抽。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { newKgId } from "../../application/knowledge-graph/ids";
import { runExtractionTick, type ExtractionTickResult } from "../../application/knowledge-graph/extract-message-knowledge";
import {
  KG_EXTRACTION_QUEUE_PORT, KG_EXTRACTION_SOURCE_PORT, KNOWLEDGE_EXTRACTOR_PORT, ONTOLOGY_STORE_PORT,
  type KgExtractionQueuePort, type KgExtractionSourcePort, type KnowledgeExtractorPort, type OntologyStorePort,
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
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
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
      return await runExtractionTick({
        queue: this.queue, source: this.source, extractor: this.extractor, store: this.store,
        logger: this.logger, newId: newKgId,
      });
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
