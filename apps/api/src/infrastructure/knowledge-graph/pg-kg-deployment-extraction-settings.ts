/**
 * 用户直接交办（2026-09-25，ad-hoc）—— `KgDeploymentExtractionSettingsPort` 的 Postgres 实现。
 *
 * `kg_extraction_state` 全库只有一行、不是租户数据、没有 RLS，全部经 `withoutTenant`（同
 * `PgKgExtraction.enable()`/`pendingOrgs()` 读写这张表 / 这个单例的既有手法）。写走新增的
 * `kg_extraction_set_enabled(v)`（双向），不经 `guard()`：这张表背后没有 `ObjectRef` 能表达
 * 的 ACL 对象——同 `PgKgOrgExtractionSettings` 一样，真正的裁决在应用层（新增的平台级
 * 抽取设置 controller，`PlatformOperatorGuard`）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgDeploymentExtractionSettingsPort } from "../../application/knowledge-graph/ports";

export class PgKgDeploymentExtractionSettings implements KgDeploymentExtractionSettingsPort {
  constructor(private readonly db: DatabasePort) {}

  async getEnabled(): Promise<boolean> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton");
      // 迁移 20260924210000 在部署首次跑迁移时就把这一行种出来了（`ON CONFLICT DO NOTHING`）；
      // 没有行时按关处理而不是抛错，纯粹防御——正常运行时这个分支不会走到。
      return r.rows[0]?.enabled ?? false;
    });
  }

  async setEnabled(enabled: boolean, updatedByUserId: string): Promise<boolean> {
    return this.db.withoutTenant(async (s) => {
      await s.query("SELECT kg_extraction_set_enabled($1)", [enabled]);
      const r = await s.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton");
      const row = r.rows[0];
      // 同 `PgKgOrgExtractionSettings.setEnabled`：没有行说明写没落地，直接让调用方看到，
      // 不回一个和调用方期望相反的假象。`updatedByUserId` 目前不落库（这张表没有 `updated_by`
      // 列——它是部署级单行开关，不是需要审计"谁改的"的逐组织配置；留这个参数只是为了
      // 与 `KgOrgExtractionSettingsPort.setEnabled` 同一个方法签名，供 controller 层统一处理）。
      void updatedByUserId;
      if (row === undefined) throw new Error("kg_extraction_state set_enabled returned no row");
      return row.enabled;
    });
  }
}
