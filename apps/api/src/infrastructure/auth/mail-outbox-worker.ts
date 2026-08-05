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
    if (!this.config.workerEnabled) return;
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
