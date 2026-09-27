/**
 * Phase 18 S9（#4366）—— 嵌入一轮：各 org 待嵌入的结论 / 实体 → 部署配置的嵌入模型 → object_embeddings。
 *
 * - 写入即排队（数据库触发器，同一事务），这里只消费；结论写入从不等它（06-UX R3-8「不拖慢对话」）。
 * - 嵌入服务整体不可用（`embedding_unavailable` / 超时 / 未配置）不是某个目标的错：本轮就此停下、不计失败次数，
 *   outbox 原样保留，服务恢复后自动补齐；这期间召回的向量通道对还没嵌入的结论只是没有命中，字面 + 图照常。
 * - 单个目标失败（写回被库拒：维度不符、模型未登记）记一次，超过上限进死信，不卡住整个 org。
 * - 失败原因只记固定错误码，从不记正文（结论可能是个人空间的内容）。
 */
import type { LoggerPort } from "../ports/logger.port";
import type { EmbeddingPort } from "../retrieval/ports";
import type { KgEmbeddingQueuePort } from "./ports";

/** 每个 org 每轮最多嵌入的目标数：嵌入是一次模型调用，一个活跃的 org 不该让别的 org 等太久。 */
export const KG_EMBEDDING_BATCH = 16;

export interface EmbeddingTickResult {
  readonly processed: number;
  readonly written: number;
  readonly stale: number;
  readonly failed: number;
  /** 嵌入服务这一轮不可用（本轮提前停下）。 */
  readonly providerUnavailable: boolean;
}

export interface EmbeddingDeps {
  readonly queue: KgEmbeddingQueuePort;
  readonly embeddings: EmbeddingPort;
  readonly logger: LoggerPort;
}

/** 结构化错误码：只认 `embedding_*` / `KG_*` 形状的，其余一律归为一个固定码（驱动 / 库的原文可能带数据）。 */
function errorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return /^(?:embedding_[a-z_]+|KG_[A-Z_]+)$/.test(m) ? m : "kg_embedding_write_rejected";
}

export async function runEmbeddingTick(deps: EmbeddingDeps): Promise<EmbeddingTickResult> {
  let processed = 0, written = 0, stale = 0, failed = 0;
  const model = { model: deps.embeddings.model, modelVersion: deps.embeddings.modelVersion };
  for (const orgId of await deps.queue.pendingOrgs()) {
    const targets = await deps.queue.pending(orgId, KG_EMBEDDING_BATCH);
    for (const t of targets) {
      processed += 1;
      let vector: readonly number[];
      try {
        vector = await deps.embeddings.embed(t.content);
      } catch (err) {
        // 服务整体不可用：不是这个目标的错，不计次数；整轮停下，下一轮再来（outbox 行都还在）。
        deps.logger.error("kg embedding provider unavailable, pausing embedding tick", {
          traceId: "kg-embedding", orgId, code: errorCode(err), err: new Error(errorCode(err)),
        });
        return { processed, written, stale, failed, providerUnavailable: true };
      }
      try {
        if ((await deps.queue.write(orgId, t, model, vector)) === "written") written += 1;
        else stale += 1;
      } catch (err) {
        failed += 1;
        const code = errorCode(err);
        deps.logger.error("kg embedding write rejected", {
          traceId: "kg-embedding", orgId, targetKind: t.targetKind, targetId: t.targetId, code, err: new Error(code),
        });
        await deps.queue.fail(orgId, t, code).catch(() => undefined);
      }
    }
  }
  return { processed, written, stale, failed, providerUnavailable: false };
}
