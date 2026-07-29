/**
 * `OrgLifecycleRepository` on PostgreSQL (F22 / O-29 ③).
 *
 * ## 这个文件**不**实现只读降级
 *
 * 冻结在迁移 0012 的 RESTRICTIVE 策略里。这里只做三件事：读清单、打标记、撤标记。
 * 之所以要在文件头说清楚，是因为「在 repository 里顺手加一句
 * `if (row.status === 'disabled') throw` 」看起来非常合理——而它会让判定变成两处，
 * 于是**新加的那条写路径**（不经过这个 repository 的那条）不受任何约束，
 * 却因为这里有一句检查而显得已经被管住了。auth 的 domain.md 把「强制」划给 PG RLS，
 * 就是为了让这句话只有一个落点。
 *
 * ## 为什么读走 `Guarded<T>`
 *
 * `lint-permission-paths` 的规则：任何在 SQL 里点名租户表的文件，
 * 必须在 `infrastructure/` 且走 `application/security/permission-filter`。
 * 这不是为过 lint 套的壳——那份文件头写着「两个门之间，没人看的那个会漏」。
 * 组织导出清单（含每张表有多少行）就是租户数据，它凭什么例外。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  OrgExportPayload,
  OrgLifecycleRepository,
  OrgLifecycleRow,
} from "../../application/auth/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type { z } from "zod";
import type { identity } from "@repo/contracts";

interface OrgRow {
  id: string;
  name: string;
  /** ⚠ 从契约的 `OrgKind` 取，不在这里复述字面量——F16 的单一事实源门控会红。 */
  kind: z.infer<typeof identity.OrgKind>;
  model_policy: string;
  status: "active" | "disabled";
  disabled_at: Date | null;
  retention_until: Date | null;
}

export class PgOrgLifecycleRepository implements OrgLifecycleRepository {
  constructor(private readonly db: DatabasePort) {}

  async readExportManifest(orgId: OrgId): Promise<Guarded<OrgExportPayload> | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OrgRow>(
        `SELECT id, name, kind, model_policy, status, disabled_at, retention_until
           FROM organizations WHERE id = $1`,
        [orgId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;

      const org: OrgLifecycleRow = {
        orgId: row.id,
        name: row.name,
        kind: row.kind,
        modelPolicy: row.model_policy,
        status: row.status,
        disabledAt: row.disabled_at,
        retentionUntil: row.retention_until,
      };

      return guard<OrgExportPayload>(
        // ⚠ `kind: "organization"` —— 刻意不是 `project`。它不在 `AclObjectRef` 里，
        // 所以**编译期**就走不到 `authorize`，而 authorize 会把「仅管理员」判成「任何成员」
        // （没有 binding 行 ⇒ 落到宽松默认 scope）。见 application/identity/ports.ts 的长注。
        { kind: "organization", id: orgId },
        { org, tables: await this.tableCounts(s, orgId) },
      );
    });
  }

  /**
   * 每张租户表在本组织下有多少行 —— **表名从 catalog 推，不写死**。
   *
   * 与 `kernel_tenant_table_audit()` 同源的推导（带 org_id 且该列有指向租户根表的外键），
   * 同样的理由：手维护的列表缺的永远是刚加的那张表。
   * 而导出少一张表比导出失败更坏——客户以为自己把数据都带走了。
   *
   * ⚠ 计数走的是**当前租户上下文**下的普通 SELECT，所以 RLS 仍然在起作用：
   * 这个方法数不出别的组织有多少行，即使 orgId 被传错。用
   * `count(*) WHERE org_id = $1` 而不是 `pg_class.reltuples`，因为后者是统计估算值，
   * 一份「你有 1000 条数据」的导出清单不能是估的。
   */
  private async tableCounts(
    s: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
    orgId: OrgId,
  ): Promise<{ table: string; rowCount: number }[]> {
    const tables = await s.query<{ name: string }>(
      `SELECT c.relname::text AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM pg_constraint con
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
             WHERE con.conrelid = c.oid AND con.contype = 'f'
               AND a.attname = 'org_id' AND array_length(con.conkey, 1) = 1
          )
        ORDER BY 1`,
    );

    const out: { table: string; rowCount: number }[] = [];
    for (const t of tables.rows) {
      // 表名来自 pg_catalog，不是用户输入，但仍然只允许 [a-z0-9_]：
      // 一个能拼进 SQL 的名字，来源可信与否是会变的，而这条检查不会。
      if (!/^[a-z_][a-z0-9_]*$/.test(t.name)) continue;
      const c = await s.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${t.name} WHERE org_id = $1`,
        [orgId],
      );
      out.push({ table: t.name, rowCount: Number(c.rows[0]?.n ?? "0") });
    }
    return out;
  }

  /**
   * 打上停用标记。
   *
   * ⚠ `disabled_at` 与 `retention_until` 都是**参数**，不是 `now()` / `now() + interval`。
   * 留存期只有一份（契约 `AUTH_POLICY.orgRetentionDays`，出处 O-01），
   * 由 `domain/auth/org-lifecycle.ts` 的 `retentionUntil()` 算好传进来。
   * 在 SQL 里写 `interval '180 days'` 就是第二份副本，漂移方向是「TS 改了、SQL 没改」，
   * 两边都不报错，新旧停用的组织按两套策略。
   *
   * ⚠ 走 `withTenant`：`organizations` 也是 FORCE RLS 的，这条 UPDATE 必须与其他所有写
   * 经过同一条策略。停用路径不给自己开特权门——这与 F19 注册路径的理由是同一条。
   * 而 organizations **不在** 0012 的冻结范围里（它承载标记本身），所以对一个已停用的
   * 组织执行 `reactivate` 不会被自己冻住——否则「停用」就偷偷变成了「删除」。
   */
  async disable(orgId: OrgId, disabledAt: Date, retention: Date): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE organizations
            SET status = 'disabled', disabled_at = $2, retention_until = $3
          WHERE id = $1`,
        [orgId, disabledAt, retention],
      ),
    );
  }

  async reactivate(orgId: OrgId): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        // 三个字段一起清。CHECK `organizations_disabled_is_atomic` 会拒掉只清一半的写法——
        // 「不是停用状态但留着一个留存截止日期」答不出「这个日期是干什么的」。
        `UPDATE organizations
            SET status = 'active', disabled_at = NULL, retention_until = NULL
          WHERE id = $1`,
        [orgId],
      ),
    );
  }
}
