/**
 * `ApplyBlueprintResolverPort` 的 PostgreSQL 实现（F23 补实现 / #1667）。
 *
 * 纯读，与 `pg-blueprint-reference-repository.ts`（project 束，BP-08）同一形状的先例：
 * ① 版本存不存在/是否归档、② 蓝本活表当前 `duration_tier`——这里额外多读一步
 * ③ 目标版本 `content['flow-agenda']`（F23 补实现新增的读取面，P10 已过期）。
 */
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { BlueprintVersion, BlueprintVersionState } from "../../domain/templates/blueprint-version";
import type { DurationTier } from "../../domain/templates/apply-blueprint-init";
import type {
  ApplyBlueprintResolverPort,
  ResolveApplyBlueprintOutcome,
} from "../../application/templates/apply-blueprint-resolver-ports";
import type { DatabasePort } from "../../application/ports/database.port";
import { discloseDecided, guard, isDisclosed } from "../../application/security/permission-filter";

interface BlueprintRow {
  id: string;
  duration_tier: DurationTier;
}

interface VersionRow {
  id: string;
  blueprint_id: string;
  version_number: number;
  content: Record<string, unknown>;
  changed_design_facet_keys: string[];
  rolled_back_from: string | null;
  state: BlueprintVersionState;
}

const NOT_FOUND: ResolveApplyBlueprintOutcome = {
  blueprintExists: false,
  visibleToActor: false,
  resolvedVersion: null,
  tier: "custom",
  filledFacetKeys: [],
  flowAgendaContent: null,
};

export class PgApplyBlueprintResolver implements ApplyBlueprintResolverPort {
  constructor(private readonly db: DatabasePort) {}

  async resolve(
    orgId: OrgId,
    blueprintId: string,
    versionId: string | null,
    actorOrgRole: OrgRole | null,
    actorTeamId: string | null,
  ): Promise<ResolveApplyBlueprintOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      const blueprintRes = await s.query<BlueprintRow>(
        `SELECT id, duration_tier FROM blueprints WHERE id = $1`,
        [blueprintId],
      );
      const blueprint = blueprintRes.rows[0];
      if (blueprint === undefined) return NOT_FOUND;

      // 可见性：与 `pg-blueprint-reference-repository.ts` 同一份判定函数
      // （#991 裁③单一事实源）。BP-01 起蓝本恒 `scope: "org-wide"`——见该文件同款说明。
      const decision = decideCapabilityVisibility({
        decisionId: `applyBlueprint-resolve:${blueprintId}`,
        orgRole: actorOrgRole,
        requesterTeamId: actorTeamId,
        scope: "org-wide",
        ownerTeamId: null,
      });
      const listing = guard({ kind: "capability", id: `blueprint:${blueprintId}` }, { blueprintId });
      const disclosed = discloseDecided(listing, decision);
      if (!isDisclosed(disclosed)) {
        return { ...NOT_FOUND, blueprintExists: true, visibleToActor: false };
      }

      const versionRes =
        versionId !== null
          ? await s.query<VersionRow>(
              `SELECT id, blueprint_id, version_number, content, changed_design_facet_keys, rolled_back_from, state
                 FROM blueprint_versions WHERE id = $1 AND blueprint_id = $2`,
              [versionId, blueprintId],
            )
          : await s.query<VersionRow>(
              `SELECT id, blueprint_id, version_number, content, changed_design_facet_keys, rolled_back_from, state
                 FROM blueprint_versions WHERE blueprint_id = $1 AND state = 'published'
                ORDER BY version_number DESC LIMIT 1`,
              [blueprintId],
            );
      const versionRow = versionRes.rows[0];

      if (versionRow === undefined) {
        return {
          blueprintExists: true,
          visibleToActor: true,
          resolvedVersion: null,
          tier: blueprint.duration_tier,
          filledFacetKeys: [],
          flowAgendaContent: null,
        };
      }

      const resolvedVersion: BlueprintVersion = {
        id: versionRow.id,
        blueprintId: versionRow.blueprint_id,
        versionNumber: versionRow.version_number,
        content: versionRow.content,
        changedDesignFacetKeys: versionRow.changed_design_facet_keys,
        rolledBackFrom: versionRow.rolled_back_from,
        state: versionRow.state,
      };

      const flowAgendaRaw = versionRow.content["flow-agenda"];
      const flowAgendaContent = typeof flowAgendaRaw === "string" ? flowAgendaRaw : null;

      return {
        blueprintExists: true,
        visibleToActor: true,
        resolvedVersion,
        tier: blueprint.duration_tier,
        filledFacetKeys: Object.keys(versionRow.content),
        flowAgendaContent,
      };
    });
  }
}
