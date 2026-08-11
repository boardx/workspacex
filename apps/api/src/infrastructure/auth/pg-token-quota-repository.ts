/**
 * F160 —— `TokenQuotaRepository` on PostgreSQL。
 *
 * ## I-Q1（逐人之和 ≤ 组织额度）真正住在哪一行
 *
 * `setMemberQuota` 的 `SELECT ... FROM org_token_budget ... FOR UPDATE`，以及紧随其后
 * 在**同一个 `withTenant` 事务**里的求和与 UPSERT。把那三步拆成「先查后写」两次往返，
 * 功能仍然完全正常：管理员点保存、数字更新、没有任何报错——只不过两个管理员同时提额时
 * 双双通过，合计超发，而两次请求的日志都干干净净。
 * ⇒ `member-token-quota-overallocation-rejected.test.ts` 里那条并发用例就是做这一步。
 *
 * ⚠ `FOR UPDATE` 锁的是**组织额度那一行**，不是逐人的额度行：它要序列化的是「同一个
 *   组织的两次调整」，锁在人身上锁不住这件事（两个管理员改的是两个不同的人）。
 *   组织额度未设置（无行）时用 `pg_advisory_xact_lock(hashtext(org_id))` 顶上——
 *   没有行可锁，但仍然需要互斥；不这么做的话「未设置额度」这条路径恰好是唯一
 *   不受保护的那条，而它是新组织的默认状态。
 *
 * ## 本月已用的口径
 *
 * `date_trunc('month', now())` 起的自然月，与「本月组织额度」的结算周期一致。
 * ⚠ 时区取数据库会话的 `TimeZone`（部署为 UTC）。跨时区组织的月初边界因此可能与
 *   当地日历差几小时——具名缺口 `GAP-QUOTA-MONTH-TZ`：真要按组织所在地结算，
 *   得先有「组织时区」这个字段，而它今天不存在，不在这里现造一个。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import {
  BudgetBelowAllocatedError, QuotaOverallocatedError,
  type MemberQuotaRow, type OrgQuotaSnapshot, type TokenQuotaRepository,
} from "../../application/auth/token-quota-ports";

/** pg 把 bigint 作为字符串返回；统一在这里收口，别让字符串漏进用例层的算术。 */
const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

export class PgTokenQuotaRepository implements TokenQuotaRepository {
  constructor(private readonly db: DatabasePort) {}

  async readSnapshot(orgId: OrgId): Promise<OrgQuotaSnapshot> {
    return this.db.withTenant(orgId, async (s) => {
      const budget = await s.query<{ monthly_budget: string }>(
        "SELECT monthly_budget FROM org_token_budget WHERE org_id = $1",
        [orgId],
      );

      const members = await s.query<{
        user_id: string; display_name: string; email: string; org_role: string;
        team_id: string | null; monthly_limit: string | null; used_tokens: string;
      }>(
        /*
         * 一次 join 给全「分了多少」与「用了多少」。
         * ⚠ LEFT JOIN 而非 JOIN：**没有额度的成员必须出现在列表里**——他们恰恰是
         *   管理员要去分配额度的那些人，JOIN 会让他们从这一屏上消失。
         * ⚠ 用量子查询限定在本自然月，且不区分 succeeded/failed：失败的调用也是用量
         *   （F159 的取舍），「这周怎么烧了这么多」的答案里包含失败重试。
         */
        `SELECT m.user_id, c.display_name, c.email, m.org_role, m.team_id,
                q.monthly_limit,
                COALESCE(u.used_tokens, 0) AS used_tokens
           FROM org_memberships m
           JOIN credentials c ON c.user_id = m.user_id
           LEFT JOIN member_token_quota q ON q.org_id = m.org_id AND q.user_id = m.user_id
           LEFT JOIN (
                SELECT user_id, SUM(tokens_total) AS used_tokens
                  FROM token_usage_events
                 WHERE org_id = $1 AND occurred_at >= date_trunc('month', now())
                 GROUP BY user_id
           ) u ON u.user_id = m.user_id
          WHERE m.org_id = $1
          ORDER BY m.joined_at ASC, m.user_id ASC`,
        [orgId],
      );

      const orgUsed = await s.query<{ total: string | null }>(
        `SELECT SUM(tokens_total) AS total FROM token_usage_events
          WHERE org_id = $1 AND occurred_at >= date_trunc('month', now())`,
        [orgId],
      );

      const rows: MemberQuotaRow[] = members.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        orgRole: r.org_role,
        teamId: r.team_id,
        // null 原样传下去：`null`（未分配）与 `0`（分了 0）在界面上是两句不同的话。
        monthlyLimit: r.monthly_limit === null ? null : num(r.monthly_limit),
        usedTokens: num(r.used_tokens),
      }));

      return {
        orgBudget: budget.rows.length === 0 ? null : num(budget.rows[0]!.monthly_budget),
        allocated: rows.reduce((sum, r) => sum + (r.monthlyLimit ?? 0), 0),
        orgUsed: num(orgUsed.rows[0]?.total ?? null),
        members: rows,
      };
    });
  }

  async setMemberQuota(
    orgId: OrgId,
    input: { readonly userId: string; readonly monthlyLimit: number; readonly updatedBy: string },
  ): Promise<{ readonly allocated: number; readonly orgBudget: number | null }> {
    return this.db.withTenant(orgId, async (s) => {
      // 组织内互斥（见文件头）：有额度行就锁那一行，没有就用 advisory 锁顶上。
      await s.query("SELECT pg_advisory_xact_lock(hashtext($1))", [orgId]);
      const budget = await s.query<{ monthly_budget: string }>(
        "SELECT monthly_budget FROM org_token_budget WHERE org_id = $1 FOR UPDATE",
        [orgId],
      );
      const orgBudget = budget.rows.length === 0 ? null : num(budget.rows[0]!.monthly_budget);

      const others = await s.query<{ total: string | null }>(
        `SELECT SUM(monthly_limit) AS total FROM member_token_quota
          WHERE org_id = $1 AND user_id <> $2`,
        [orgId, input.userId],
      );
      const allocatedByOthers = num(others.rows[0]?.total ?? null);
      const allocated = allocatedByOthers + input.monthlyLimit;

      if (orgBudget !== null && allocated > orgBudget) {
        // 不写入，并把「还剩多少可分」带出去——只说「超了」等于让管理员靠试。
        throw new QuotaOverallocatedError(Math.max(0, orgBudget - allocatedByOthers));
      }

      await s.query(
        `INSERT INTO member_token_quota (org_id, user_id, monthly_limit, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, user_id)
         DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [orgId, input.userId, input.monthlyLimit, input.updatedBy],
      );

      return { allocated, orgBudget };
    });
  }

  async setOrgBudget(
    orgId: OrgId,
    input: { readonly monthlyBudget: number; readonly updatedBy: string },
  ): Promise<{ readonly allocated: number }> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT pg_advisory_xact_lock(hashtext($1))", [orgId]);
      const allocatedRow = await s.query<{ total: string | null }>(
        "SELECT SUM(monthly_limit) AS total FROM member_token_quota WHERE org_id = $1",
        [orgId],
      );
      const allocated = num(allocatedRow.rows[0]?.total ?? null);

      if (input.monthlyBudget < allocated) {
        // 不静默截断谁的额度：「谁被砍」是管理员要亲自做的决定，不是服务端替他做。
        throw new BudgetBelowAllocatedError(allocated);
      }

      await s.query(
        `INSERT INTO org_token_budget (org_id, monthly_budget, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id)
         DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [orgId, input.monthlyBudget, input.updatedBy],
      );

      return { allocated };
    });
  }

  async isOrgMember(orgId: OrgId, userId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{ one: number }>(
        "SELECT 1 AS one FROM org_memberships WHERE org_id = $1 AND user_id = $2",
        [orgId, userId],
      );
      return res.rows.length > 0;
    });
  }
}
