import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CLOCK, type Clock } from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_TOKEN_CODEC,
  VERIFICATION_MAIL_TRANSPORT,
  type EmailVerificationRepository,
  type EmailVerificationTokenCodec,
  type VerificationMailTransport,
} from "../../application/auth/email-verification-ports";
import { deliverOneVerificationMail } from "../../application/auth/email-verification";
import type { CloudflareEmailConfig } from "./cloudflare-email-transport";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";

export const CLOUDFLARE_EMAIL_CONFIG = Symbol("CloudflareEmailConfig");

@Injectable()
export class MailOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private readonly repo: EmailVerificationRepository,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly tokens: EmailVerificationTokenCodec,
    @Inject(VERIFICATION_MAIL_TRANSPORT) private readonly transport: VerificationMailTransport,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CLOUDFLARE_EMAIL_CONFIG) private readonly config: CloudflareEmailConfig,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    // ⚠ 邮件配置在生产模式下缺任何一项都会抛（`cloudflareEmailConfig`），而这里是
    //   模块初始化 —— 直接读它等于**让整个 API 因为一个投递子系统没配好而起不来**。
    //   2026-08-05 实测过这个后果：运行时门控 G7 红了一整轮，报出来只有
    //   `child exited with 1`；而核心闭环第 1 步走 bootstrap，根本不发邮件。
    //
    //   ⇒ 正确形态是「**这个 worker 不启动，并说清楚为什么**」，不是「进程不活」。
    //     配置缺失仍然是错误、仍然被记录，只是它的爆炸半径收回到自己这一块。
    let enabled: boolean;
    try {
      enabled = this.config.workerEnabled;
    } catch (e) {
      this.logger.error("mail outbox worker disabled: delivery configuration is incomplete", {
        traceId: "mail-outbox-worker",
        err: e,
      });
      return;
    }
    if (!enabled) return;
    this.timer = setInterval(() => void this.poll(), 5_000);
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
      await deliverOneVerificationMail({
        now: this.clock.now(),
        appPublicUrl: this.config.appPublicUrl,
        repo: this.repo,
        tokens: this.tokens,
        transport: this.transport,
      });
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("mail outbox poll failed", { traceId: "mail-outbox-worker", err });
    }
  }
}
