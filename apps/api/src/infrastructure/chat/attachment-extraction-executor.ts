/**
 * #946 · F153/W1（V9-b）—— `AttachmentExtractionExecutorPort` 实现：kick 排空某租户的抽取队列。
 *
 * 形态镜像 `agent-run-executor`：kick 是 fire-and-forget（不拖慢上传），`autostart` 决定本进程
 * 是否执行抽取（迁到独立 worker 进程时置 0）。并发 = `concurrency`（默认 2）：起 N 条排空循环，
 * 各自 `claimNext`（`FOR UPDATE SKIP LOCKED` 保证不重复认领），一直认到没活。
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { ObjectStore } from "../../application/artifact/ports";
import type { AttachmentToMarkdownPort } from "../../application/chat/attachment-to-markdown.port";
import type { AttachmentVisionPort } from "../../application/chat/attachment-vision.port";
import type { AttachmentExtractionStore } from "../../application/chat/attachment-extraction-store";
import type { AttachmentExtractionExecutorPort } from "../../application/chat/attachment-extraction-executor.port";
import {
  runExtractionTick, type AttachmentExtractionDeps,
} from "../../application/chat/attachment-extraction-worker";

/** 单次 kick 内单条循环的认领上限——防病态无限循环（正常在队列排空时早已 break）。 */
const MAX_DRAIN_ITERATIONS = 500;

export class AttachmentExtractionExecutor implements AttachmentExtractionExecutorPort {
  private readonly deps: AttachmentExtractionDeps;

  constructor(
    store: ObjectStore,
    extraction: AttachmentExtractionStore,
    converter: AttachmentToMarkdownPort,
    /** #1560 P1：图片视觉抽取端口（与 converter 并列的第二条产文本路径）。 */
    vision: AttachmentVisionPort,
    private readonly logger: LoggerPort,
    private readonly autostart: boolean,
    private readonly concurrency = 2,
  ) {
    this.deps = {
      store,
      extraction,
      converter,
      vision,
      log: (message, ctx) => this.logger.error(message, { traceId: randomUUID(), err: message, ...ctx }),
    };
  }

  kick(orgId: OrgId): void {
    if (!this.autostart) return;
    void this.drain(orgId).catch((err) => {
      // 抽取结果都已在附件行/对象存储里持久（或仍在 outbox 待认领），到这里说明 claim 本身炸了；
      // job 留在 pending，下一次 kick 重试。绝不因抽取子系统把上传/消息链路拖挂。
      this.logger.error("attachment extraction drain failed before claiming", {
        traceId: randomUUID(), err: "drain_failed", orgId,
      });
    });
  }

  /** 排空该租户队列：起 concurrency 条循环并发认领处理。 */
  async drain(orgId: OrgId): Promise<void> {
    const loops = Array.from({ length: this.concurrency }, (_unused, i) =>
      this.drainOne(orgId, `extract-${i}-${randomUUID()}`),
    );
    await Promise.all(loops);
  }

  private async drainOne(orgId: OrgId, workerId: string): Promise<void> {
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i++) {
      const r = await runExtractionTick(this.deps, orgId, workerId);
      if (!r.claimed) return; // 队列排空
    }
  }
}
