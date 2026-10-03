/**
 * F159 —— `token_usage_events` 的唯一写入实现。
 *
 * ## 这个文件的全部主张就是「只有它写」
 *
 * `token_usage_events` 是三块产品能力的共同上游：成员配额的「本月已用」、用量监控的
 * 四窗口聚合、限额策略的触发判定。三块都从这一条流水派生，所以流水必须只有一个源头——
 * 出现第二个 `INSERT INTO token_usage_events`，就等于允许两处对「这次调用算多少 token」
 * 给出不同答案，而两个答案都会各自显示在界面上、各自看起来很合理。
 *
 * ⇒ `tests/auth/token-usage-single-write-path.test.ts` 扫描 `apps/api/src` 全部源码，
 *   断言那条 INSERT 的字面量只出现在本文件里。这段注释不做门控，那个测试做。
 *
 * Bounded retries reuse the receipt id, so a lost commit acknowledgement cannot double
 * count. Exhausted retries still surface the existing metering failure signal. This is
 * not a durable outbox: process crashes and sustained database outages remain gaps.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { TokenUsageMeterPort, TokenUsageRecord } from "../../application/agent-run/ports";

export class PgTokenUsageRepository implements TokenUsageMeterPort {
  constructor(private readonly db: DatabasePort) {}

  async startRequest(orgId: OrgId, input: Parameters<NonNullable<TokenUsageMeterPort["startRequest"]>>[1]): Promise<void> {
    await this.db.withTenant(orgId, async s => {
      await s.query(`INSERT INTO model_request_starts
        (id,org_id,user_id,run_id,execution_attempt_id,project_id,model_provider,model_id,started_at,thread_id,agent_id,call_purpose)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING`,
        [input.requestId, orgId, input.userId, input.runId, input.executionAttemptId,
          input.projectId, input.modelProvider, input.modelId, input.startedAt, input.threadId ?? null, input.agentId ?? null, input.callPurpose ?? null]);
    });
  }

  async record(orgId: OrgId, usage: TokenUsageRecord): Promise<void> {
    const eventId = usage.eventId ?? randomUUID();
    // Validate before SQL: NaN/Infinity/unsafe integers must never become a ledger fact.
    const count = (value: number): number => {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid token usage count");
      return value;
    };
    if (usage.costMicros !== undefined && (usage.costMicros < 0n || usage.costMicros > 9_223_372_036_854_775_807n
      || !usage.currency || !usage.priceVersion)) throw new Error("invalid token usage price");
    if (usage.costMicros === undefined && (usage.currency !== undefined || usage.priceVersion !== undefined)) throw new Error("incomplete token usage price");
    if (usage.cacheInputTokens != null && usage.promptTokens != null && usage.cacheInputTokens > usage.promptTokens) throw new Error("invalid cache input subset");
    if (usage.reasoningOutputTokens != null && usage.completionTokens != null && usage.reasoningOutputTokens > usage.completionTokens) throw new Error("invalid reasoning output subset");
    const params = [eventId, orgId, usage.userId, usage.runId, usage.modelProvider, usage.modelId,
      count(usage.tokensTotal),
      usage.promptTokens === null ? null : count(usage.promptTokens),
      usage.completionTokens === null ? null : count(usage.completionTokens), usage.outcome,
      usage.totalSource ?? "legacy", usage.projectId ?? null, usage.threadId ?? null, usage.agentId ?? null, usage.callPurpose ?? null, usage.requestStartedAt ?? null, usage.requestEndedAt ?? null, usage.executionAttemptId ?? null, usage.costMicros?.toString() ?? null, usage.currency ?? null, usage.priceVersion ?? null, usage.cacheInputTokens == null ? null : count(usage.cacheInputTokens), usage.reasoningOutputTokens == null ? null : count(usage.reasoningOutputTokens)];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.db.withTenant(orgId, async (s) => {
          await s.query(
            `INSERT INTO token_usage_events
           (id, org_id, user_id, run_id, model_provider, model_id,
            tokens_total, tokens_prompt, tokens_completion, outcome,
            total_source, project_id, thread_id, agent_id, call_purpose, request_started_at, request_ended_at, execution_attempt_id, cost_micros, currency, price_version, tokens_cache_input, tokens_reasoning_output)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         ON CONFLICT (id) DO NOTHING`,
            params,
          );
        });
        return;
      } catch (error) {
        // Retry only transient PG/connection errors; missing migrations and permissions
        // must fail immediately. Each attempt opens a fresh tenant transaction.
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (attempt === 2 || !["40001", "40P01", "08006", "08003", "ECONNRESET", "ETIMEDOUT"].includes(code)) throw error;
      }
    }
  }
}
