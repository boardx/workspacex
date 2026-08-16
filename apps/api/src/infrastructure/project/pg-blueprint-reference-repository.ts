/**
 * `BlueprintReferenceRepository` 的 PostgreSQL 实现（BP-08，人类 2026-08-16 裁：最小闭环 B）。
 *
 * 唯一读方法：给定一个 `blueprintVersionId`，判"这条引用今天能不能用来建项目"。
 * 纯读——不写任何表；写入（`blueprint_bindings` 一行）由 `PgProjectRepository.create()`
 * 在自己的事务里完成（见该文件头注），不在这里做，避免"读的人也能写"混淆两个仓储各自的
 * `lint-permission-paths` 豁免边界。
 *
 * ## 为什么两条 SELECT，不是一条 JOIN
 *
 * `blueprint_versions` 与 `blueprints` 是两张不同粒度的表——版本是冻结快照，蓝本行的
 * `duration_tier` 是活值。JOIN 会让"读到的是同一个事务快照"这件事更隐蔽；分两条读、
 * 各自职责单一（① 版本存不存在/是否归档/冻结的 `content`，② 蓝本活表当前 `duration_tier`），
 * 读起来更接近它们在语义上本就是两件事（同一个理由，`get-designer-shell.ts` 那类薄编排
 * 也不强行合并跨语义粒度的读）。
 */
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { DurationTier } from "../../domain/templates/apply-blueprint-init";
import type {
  BlueprintReferenceRepository,
  ResolveBlueprintReferenceOutcome,
} from "../../application/project/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import { discloseDecided, guard, isDisclosed } from "../../application/security/permission-filter";

interface VersionRow {
  blueprint_id: string;
  content: Record<string, unknown>;
  state: "published" | "archived";
}

interface BlueprintRow {
  duration_tier: DurationTier;
}

export class PgBlueprintReferenceRepository implements BlueprintReferenceRepository {
  constructor(private readonly db: DatabasePort) {}

  async resolve(
    orgId: OrgId,
    blueprintVersionId: string,
    actorOrgRole: OrgRole | null,
    actorTeamId: string | null,
  ): Promise<ResolveBlueprintReferenceOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      const versionRes = await s.query<VersionRow>(
        `SELECT blueprint_id, content, state FROM blueprint_versions WHERE id = $1`,
        [blueprintVersionId],
      );
      const version = versionRes.rows[0];
      if (version === undefined) return { kind: "not-found" };

      if (version.state === "archived") return { kind: "version-archived" };

      const blueprintRes = await s.query<BlueprintRow>(
        `SELECT duration_tier FROM blueprints WHERE id = $1`,
        [version.blueprint_id],
      );
      const blueprint = blueprintRes.rows[0];
      if (blueprint === undefined) return { kind: "not-found" };

      // 可见性判定复用与蓝本列表/画布模板同一份 `decideCapabilityVisibility`
      //（#991 裁③单一事实源纪律，同 F189 `getInitializationPreview` 端点的先例），
      // 出门经 guard()/disclose() 走一次真实判定（`lint-permission-paths.mjs` 结构性
      // 要求：任何读租户表的 infrastructure/ 文件都必须经这道门出去，忘了判定是
      // 类型错误，不是一次疏漏）。
      // ⚠ BP-01 尚无蓝本可见性写入路径（同 `pg-blueprint-repository.ts` list() 的既有
      //   说明），蓝本此刻恒 `scope: "org-wide"`、无归属团队——这是当前的真实值，
      //   这一支判定今天恒放行，实现仍然判它是为了将来该路径落地时不必回头改这里。
      const decision = decideCapabilityVisibility({
        decisionId: `createProject-blueprint:${blueprintVersionId}`,
        orgRole: actorOrgRole,
        requesterTeamId: actorTeamId,
        scope: "org-wide",
        ownerTeamId: null,
      });
      const listing = guard(
        { kind: "capability", id: `blueprint:${version.blueprint_id}` },
        { filledFacetKeys: Object.keys(version.content), tier: blueprint.duration_tier },
      );
      const disclosed = discloseDecided(listing, decision);
      if (!isDisclosed(disclosed)) return { kind: "not-visible" };

      return {
        kind: "ok",
        blueprintId: version.blueprint_id,
        filledFacetKeys: disclosed.payload.filledFacetKeys,
        tier: disclosed.payload.tier,
      };
    });
  }
}
