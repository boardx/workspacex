/**
 * issue #2645 —— 定时对 `DEV_APP_UPTIME_URL` 探活一次,写进 `service_uptime_checks`,
 * 供运营状态屏的红绿 bar / 可用性百分比读。
 *
 * 骨架照抄 `feedback/feedback-github-issue-poll-worker.ts`
 * （`OnModuleInit`/`OnModuleDestroy` + `setInterval(...).unref()` + `running` 防重入）——
 * 那份文件头注已经论证过这套形状,这里不重复。
 *
 * ⚠ **未配置 `DEV_APP_UPTIME_URL` 只禁用这一个 worker,不拖垮整个 API**——同一条
 *   "可选子系统"纪律（`serviceUptimeConfig` 头注）:这是运维自查的锦上添花能力,
 *   不是核心业务路径,没有理由让它的缺失变成整个部署起不来。
 *
 * 每 60 秒探活一次——需求原文只说"每隔一段时间",没有给出具体数字;给个足够密的
 * 频率让红绿 bar 在几分钟内就能画出有意义的分段,又不至于把探活本身当成 DDoS。
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { recordServiceUptimeCheck } from "../../application/system/record-service-uptime-check";
import { SERVICE_UPTIME_PROBE, SERVICE_UPTIME_REPOSITORY, type ServiceUptimeProbe, type ServiceUptimeRepository } from "../../application/system/uptime-ports";
import { SERVICE_UPTIME_CONFIG, type ServiceUptimeConfig } from "./service-uptime-config";

export const SERVICE_UPTIME_POLL_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ServiceUptimePollWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private callCount = 0;

  constructor(
    @Inject(SERVICE_UPTIME_CONFIG) private readonly config: ServiceUptimeConfig,
    @Inject(SERVICE_UPTIME_PROBE) private readonly probe: ServiceUptimeProbe,
    @Inject(SERVICE_UPTIME_REPOSITORY) private readonly repo: ServiceUptimeRepository,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    if (this.config.url.length === 0) return;
    this.timer = setInterval(() => void this.poll(), SERVICE_UPTIME_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.callCount += 1;
      await recordServiceUptimeCheck(
        { probe: this.probe, repo: this.repo, logger: this.logger, now: () => new Date() },
        { service: this.config.service, url: this.config.url, timeoutMs: this.config.timeoutMs, callCount: this.callCount },
      );
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("service uptime poll failed", { traceId: "service-uptime-poll-worker", err });
    }
  }
}
