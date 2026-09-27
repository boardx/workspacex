/**
 * Phase 18 S9（#4366）—— 嵌入 worker：每 2 秒把 kg_embedding_outbox 里待嵌入的结论 / 实体嵌入、写回 object_embeddings。
 *
 * 骨架同 `kg-projection-worker.ts`。嵌入模型就是部署已有的 `EMBEDDING_PORT`（F10 检索用的同一个，
 * `langChainEmbeddingClientFromEnv`）——这里不新建任何 provider：没配置 ⇒ worker 不启动，并在启动时**明说一次**
 * 「向量通道未启用」，不静默。嵌入服务不可用 ⇒ 退避一分钟，outbox 行保留，恢复后自动补齐。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { KG_EMBEDDING_QUEUE_PORT, type KgEmbeddingQueuePort } from "../../application/knowledge-graph/ports";
import { runEmbeddingTick, type EmbeddingTickResult } from "../../application/knowledge-graph/embed-pending-knowledge";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { EMBEDDING_PORT, type EmbeddingPort } from "../../application/retrieval/ports";

export const KG_EMBEDDING_POLL_INTERVAL_MS = 2_000;
/** 嵌入服务不可用时的退避：不必每 2 秒撞一次同一堵墙。 */
export const KG_EMBEDDING_UNAVAILABLE_BACKOFF_MS = 60_000;

@Injectable()
export class KgEmbeddingWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pausedUntil = 0;
  private lastDead = 0;

  constructor(
    @Inject(KG_EMBEDDING_QUEUE_PORT) private readonly queue: KgEmbeddingQueuePort,
    @Inject(EMBEDDING_PORT) private readonly embeddings: EmbeddingPort | null,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    if (this.embeddings === null) {
      this.logger.info("kg embedding worker not started: no embedding model configured; memory recall uses text + graph only", {
        traceId: "kg-embedding", code: "embedding_not_configured",
      });
      return;
    }
    this.timer = setInterval(() => void this.poll(), KG_EMBEDDING_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<EmbeddingTickResult | null> {
    if (this.embeddings === null || this.running || Date.now() < this.pausedUntil) return null;
    this.running = true;
    try {
      const r = await runEmbeddingTick({ queue: this.queue, embeddings: this.embeddings, logger: this.logger });
      if (r.providerUnavailable) this.pausedUntil = Date.now() + KG_EMBEDDING_UNAVAILABLE_BACKOFF_MS;
      const dead = await this.queue.deadCount();
      if (dead > this.lastDead) {
        this.logger.error("kg embedding targets exceeded retry limit", {
          traceId: "kg-embedding", dead, err: new Error("kg_embedding_dead_letters"),
        });
      }
      this.lastDead = dead;
      return r;
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("kg embedding poll failed", { traceId: "kg-embedding", err });
    }
  }
}
