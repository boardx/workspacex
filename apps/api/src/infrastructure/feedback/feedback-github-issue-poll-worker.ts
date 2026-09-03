/**
 * FB-2 补——定时对账 worker：每 2 分钟跑一次 `reconcileClosedGithubIssues`。
 *
 * 骨架照抄 `../auth/mail-outbox-worker.ts`（`OnModuleInit`/`OnModuleDestroy` +
 * `setInterval(...).unref()` + `running` 防重入 + 固定 traceId 记日志）——那份
 * 文件头注已经论证过这套形状为什么长这样,这里不重复。
 *
 * ⚠ **配置缺失只禁用这一个 worker，不拖垮整个 API**——同 `MailOutboxWorker.onModuleInit`
 *   2026-08-05 那次事故的教训：`GITHUB_ISSUE_CONFIG` 是 `lazyGithubIssueConfig()`
 *   给的 Proxy,生产环境缺 `GITHUB_ISSUE_TOKEN` 时第一次访问才抛。这里在
 *   `onModuleInit` 里主动触发那一次访问、用 try/catch 兜住——命中就说明这个可选
 *   子系统没配对,只让这一个 worker 不启动、记错误日志,API 其余部分正常跑。
 *   非生产环境允许 token 为空字符串（`githubIssueConfig` 的宽松分支），这种情况
 *   下不算"配置不完整"，但轮询也做不了任何事——同样直接不启动计时器。
 */
import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { TRANSACTIONAL_MAIL_TRANSPORT, type TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
import {
  FEEDBACK_SUBMITTER_DIRECTORY,
  GITHUB_ISSUE_CREATOR,
  type FeedbackSubmitterDirectory,
  type GithubIssueCreator,
} from "../../application/feedback/notification-ports";
import { PRODUCT_FEEDBACK_REPOSITORY, type ProductFeedbackRepositoryFactory } from "../../application/feedback/ports";
import { FEEDBACK_GITHUB_ISSUE_SCANNER, type FeedbackGithubIssueScanner } from "../../application/feedback/github-issue-poll-ports";
import { reconcileClosedGithubIssues } from "../../application/feedback/reconcile-closed-github-issues";
import { GITHUB_ISSUE_CONFIG, type GithubIssueConfig } from "./github-issue-creator";

/** 需求原文是"每隔 2 分钟"——写成具名常量,不是散落在 `onModuleInit` 里的裸数字。 */
export const FEEDBACK_GITHUB_ISSUE_POLL_INTERVAL_MS = 2 * 60 * 1000;

@Injectable()
export class FeedbackGithubIssuePollWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(GITHUB_ISSUE_CONFIG) private readonly config: GithubIssueConfig,
    @Inject(FEEDBACK_GITHUB_ISSUE_SCANNER) private readonly scanner: FeedbackGithubIssueScanner,
    @Inject(PRODUCT_FEEDBACK_REPOSITORY) private readonly repos: ProductFeedbackRepositoryFactory,
    @Inject(GITHUB_ISSUE_CREATOR) private readonly githubIssues: GithubIssueCreator,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly submitterDirectory: FeedbackSubmitterDirectory,
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly mail: TransactionalMailTransport,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    let token: string;
    try {
      token = this.config.token;
    } catch (e) {
      this.logger.error("feedback github issue poll worker disabled: github issue configuration is incomplete", {
        traceId: "feedback-github-issue-poll-worker",
        err: e,
      });
      return;
    }
    // 非生产允许 token 为空("可选子系统"分支,见 `githubIssueConfig`)——但没有
    // token 就打不了任何 GitHub API,轮询没有意义,同样不启动计时器。
    if (token.length === 0) return;
    this.timer = setInterval(() => void this.poll(), FEEDBACK_GITHUB_ISSUE_POLL_INTERVAL_MS);
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
      await reconcileClosedGithubIssues({
        scanner: this.scanner,
        repos: this.repos,
        githubIssues: this.githubIssues,
        submitterDirectory: this.submitterDirectory,
        mail: this.mail,
        logger: this.logger,
        newEventId: () => randomUUID(),
      });
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error("feedback github issue poll failed", { traceId: "feedback-github-issue-poll-worker", err });
    }
  }
}
