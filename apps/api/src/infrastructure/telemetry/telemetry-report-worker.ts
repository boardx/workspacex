/**
 * D9 —— 每 `TELEMETRY_REPORT_INTERVAL_SECONDS`（D28：每天）跑一次 `runTelemetryCycle`。
 * 骨架同 `system/service-uptime-poll-worker.ts`（`setInterval(...).unref()` + 防重入）。
 *
 * 上报地址未设 / 总开关打开 ⇒ **不启动计时器**，启动时记一次日志，之后零网络。
 * 周期内任何失败都在 `runTelemetryCycle` 内吞掉——上报失败绝不影响实例任何功能。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { instanceTelemetry as T } from "@repo/contracts";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { reporterState, runTelemetryCycle } from "../../application/telemetry/run-telemetry-cycle";
import {
  TELEMETRY_FACTS_SOURCE, TELEMETRY_STATE_REPOSITORY, TELEMETRY_TRANSPORT,
  type TelemetryFactsSource, type TelemetryStateRepository, type TelemetryTransport,
} from "../../application/telemetry/telemetry-ports";
import { readDeploymentEdition } from "../deployment/edition";
import { TELEMETRY_CONFIG, type TelemetryConfig } from "./telemetry-config";

@Injectable()
export class TelemetryReportWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(TELEMETRY_CONFIG) private readonly config: TelemetryConfig,
    @Inject(TELEMETRY_STATE_REPOSITORY) private readonly state: TelemetryStateRepository,
    @Inject(TELEMETRY_FACTS_SOURCE) private readonly facts: TelemetryFactsSource,
    @Inject(TELEMETRY_TRANSPORT) private readonly transport: TelemetryTransport,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    const s = reporterState(this.config);
    if (s !== "enabled") {
      this.logger.info(`instance telemetry disabled (${s})`, { traceId: "instance-telemetry" });
      return;
    }
    this.timer = setInterval(() => void this.tick(), T.TELEMETRY_REPORT_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await runTelemetryCycle(
        { state: this.state, facts: this.facts, transport: this.transport, logger: this.logger, now: () => new Date() },
        { ...this.config, edition: readDeploymentEdition() },
      );
    } finally {
      this.running = false;
    }
  }
}
