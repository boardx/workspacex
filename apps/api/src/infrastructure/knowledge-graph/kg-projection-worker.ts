/**
 * Phase 18 F04 —— AGE 投影 worker：每 2 秒把 outbox 里的待投影行投到各 org 的图。
 *
 * 骨架同 `system/service-uptime-poll-worker.ts`（`setInterval(...).unref()` + `running` 防重入）。
 * 2 秒：抽取（F06）写完到召回（F08）能用上图路之间的延迟上限；比它更密只是空转。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { GRAPH_PROJECTION_PORT, type GraphProjectionPort } from "../../application/knowledge-graph/ports";
import { projectPendingGraph, type ProjectionTickResult } from "../../application/knowledge-graph/project-pending-graph";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";

export const KG_PROJECTION_POLL_INTERVAL_MS = 2_000;
/** 库里没有 AGE（桌面版）时的退避：不必每 2 秒撞一次同一堵墙。outbox 行保留，装上 AGE 后自动补齐。 */
export const KG_PROJECTION_UNAVAILABLE_BACKOFF_MS = 10 * 60_000;

@Injectable()
export class KgProjectionWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pausedUntil = 0;

  constructor(
    @Inject(GRAPH_PROJECTION_PORT) private readonly port: GraphProjectionPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), KG_PROJECTION_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<ProjectionTickResult | null> {
    if (this.running || Date.now() < this.pausedUntil) return null;
    this.running = true;
    try {
      const r = await projectPendingGraph(this.port, this.logger);
      if (r.graphUnavailable) this.pausedUntil = Date.now() + KG_PROJECTION_UNAVAILABLE_BACKOFF_MS;
      return r;
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("kg projection poll failed", { traceId: "kg-projection", err });
    }
  }
}
