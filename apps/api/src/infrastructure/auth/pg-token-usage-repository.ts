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
 * ## 为什么不做重试
 *
 * 写失败时调用方（`execute-run.ts` 的 `meter()`）记一行错误日志然后放行——这次调用的
 * 用量就永久少记了。具名缺口 `GAP-USAGE-WRITE-RETRY`。之所以现在不修：重试队列要么
 * 落库（那就是另一张需要签核的表），要么在内存里（进程一重启就丢，比不重试更假）。
 * 与其做一个看起来在兜底、实际兜不住的东西，不如让缺口带名字、可被查。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { TokenUsageMeterPort, TokenUsageRecord } from "../../application/agent-run/ports";

export class PgTokenUsageRepository implements TokenUsageMeterPort {
  constructor(private readonly db: DatabasePort) {}

  async record(orgId: OrgId, usage: TokenUsageRecord): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO token_usage_events
           (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          orgId,
          usage.userId,
          usage.runId,
          usage.modelProvider,
          usage.modelId,
          // 失败一律 0：数据库那条 `token_usage_events_failed_is_zero_check` 也会拦，
          // 这里先归一是为了让「失败却带着 token 数」这种调用方 bug 在应用层就不成立，
          // 而不是变成一条 CHECK 违反的 500。
          usage.outcome === "failed" ? 0 : Math.max(0, Math.trunc(usage.tokensTotal)),
          usage.outcome,
        ],
      );
    });
  }
}
