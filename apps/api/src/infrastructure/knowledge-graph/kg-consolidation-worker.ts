/**
 * Phase 18 S8（#4365）—— 记忆整合的定时 worker：每 `KG_CONSOLIDATION_INTERVAL_MS`（默认 6 小时）跑一轮
 * `runConsolidationPass`。部署开关 `kg_consolidation_state` **默认关**：关着时每轮只读一次那一行就返回
 * （平台管理员在后台「运营状态」打开后，下一轮生效，不需要重启——同部署抽取开关的做法）。
 *
 * 骨架同 kg-extraction-worker（`setInterval(...).unref()` + `running` 防重入）。一轮里一个人失败只记日志（应用层已隔离）。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { newKgId } from "../../application/knowledge-graph/ids";
import { runConsolidationPass, type ConsolidationPassResult } from "../../application/knowledge-graph/consolidate-memory";
import { KG_CONSOLIDATION_PORT, KgConsolidationError, type KgConsolidationPort } from "../../application/knowledge-graph/s8-ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";

export const KG_CONSOLIDATION_DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const KG_CONSOLIDATION_MIN_INTERVAL_MS = 60_000;

export function kgConsolidationIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.KG_CONSOLIDATION_INTERVAL_MS ?? "");
  return Number.isFinite(n) && n >= KG_CONSOLIDATION_MIN_INTERVAL_MS ? n : KG_CONSOLIDATION_DEFAULT_INTERVAL_MS;
}

@Injectable()
export class KgConsolidationWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(KG_CONSOLIDATION_PORT) private readonly consolidation: KgConsolidationPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    // 测试与桌面版不需要它自己跑：`KG_CONSOLIDATION_WORKER=0` 关掉轮询（开关仍是库里那一行）。
    if ((process.env.KG_CONSOLIDATION_WORKER ?? "1") === "0") return;
    this.timer = setInterval(() => void this.poll(), kgConsolidationIntervalMs());
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 跑一轮。上一轮没结束 ⇒ null；开关关着 ⇒ "disabled"。 */
  async runOnce(): Promise<ConsolidationPassResult | "disabled" | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const out = await runConsolidationPass({ consolidation: this.consolidation, logger: this.logger, newRunId: () => newKgId("csl") });
      if (out.users > 0) this.logger.info("kg consolidation pass", { traceId: "kg-consolidation", ...out });
      return out;
    } catch (err) {
      if (err instanceof KgConsolidationError && err.code === "KG_CONSOLIDATION_DISABLED") return "disabled";
      throw err;
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("kg consolidation poll failed", { traceId: "kg-consolidation", err });
    }
  }
}
