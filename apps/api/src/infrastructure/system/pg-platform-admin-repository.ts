/**
 * `PlatformAdminRepository` on PostgreSQL（platform-admin-role delta）。
 *
 * `platform_admins` 与 `credentials` 同维度（见该表的迁移文件头）：无 `org_id`，不受
 * RLS 约束，所以全部走 `withoutTenant`——与 `pg-credential-repository.ts` 同一处置，
 * 不需要 `lint-permission-paths` 的豁免（表本身不在派生出的"租户表"集合里，
 * 见该脚本头注："任何声明 org_id 的 CREATE TABLE，加上它们 REFERENCE 到的表"）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { PlatformAdminRepository } from "../../application/system/platform-admin-ports";

export class PgPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly db: DatabasePort) {}

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ user_id: string }>(
        "SELECT user_id FROM platform_admins WHERE user_id = $1",
        [userId],
      );
      return r.rows.length > 0;
    });
  }

  async listAdminUserIds(): Promise<ReadonlySet<string>> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ user_id: string }>("SELECT user_id FROM platform_admins");
      return new Set(r.rows.map((row) => row.user_id));
    });
  }

  async grant(userId: string, grantedBy: string): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO platform_admins (user_id, granted_by) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, grantedBy],
      );
    });
  }

  async revoke(userId: string): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      await s.query("DELETE FROM platform_admins WHERE user_id = $1", [userId]);
    });
  }
}
