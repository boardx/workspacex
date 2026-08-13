/**
 * `BlueprintPersistencePort` 的 PostgreSQL 实现（F175 / BP-01）——
 * **全仓唯一一处 `INSERT INTO blueprints`**。
 *
 * 与 `pg-project-repository.ts` 同一条纪律：创建路径只有一个写点。
 * `tests/templates/create-blueprint-persistence.test.ts` 里有一条断言扫过整个
 * `apps/api/src`，要求这句 SQL 恰好出现在**一个**文件里——没有它，「唯一」只是注释。
 *
 * ## 蓝本行与设计环节行必须同一个事务
 *
 * `origin = copy` 会连带写入源蓝本的已填内容。若拆成两次 `withTenant`（＝两次提交），
 * 「蓝本建出来了但内容没跟过来」这个中间态会**在两次提交之间真实存在**，
 * 崩在那一刻就永久留下一个空壳蓝本，而用户看到的是「复制成功」。
 * 一次 `withTenant` = 一个事务（见 `application/ports/database.port.ts`）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";
import type {
  BlueprintPersistencePort,
  BlueprintRecord,
  GuardedBlueprint,
  BlueprintState,
  CreateBlueprintCommand,
  DurationTier,
  UpdateDesignFacetCommand,
  UpdateDesignFacetOutcome,
} from "../../application/templates/blueprint-persistence-ports";

interface ListRow {
  id: string;
  name: string;
  state: BlueprintState;
  version_number: number;
  duration_tier: DurationTier;
  filled_count: string;
}

export class PgBlueprintRepository implements BlueprintPersistencePort {
  constructor(private readonly db: DatabasePort) {}

  async create(cmd: CreateBlueprintCommand): Promise<void> {
    await this.db.withTenant(cmd.orgId, async (s) => {
      await s.query(
        `INSERT INTO blueprints (id, org_id, name, state, origin, source_id, machine_generated, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
        [cmd.blueprintId, cmd.orgId, cmd.name, cmd.origin, cmd.sourceId, cmd.machineGenerated, cmd.actorId],
      );

      // 已填内容逐行写。空串不写——迁移里 content 有 `length(btrim()) > 0` 的 CHECK，
      // 「未填」的表达是**没有这一行**，不是有一行空串（否则完成度分子会把空的也数进去）。
      for (const [key, content] of cmd.designFacets) {
        if (content.trim() === "") continue;
        await s.query(
          `INSERT INTO blueprint_design_facets (blueprint_id, org_id, design_facet_key, content)
           VALUES ($1, $2, $3, $4)`,
          [cmd.blueprintId, cmd.orgId, key, content],
        );
      }
    });
  }

  async exists(orgId: OrgId, blueprintId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT id FROM blueprints WHERE id = $1 AND org_id = $2`,
        [blueprintId, orgId],
      );
      return r.rows.length > 0;
    });
  }

  async readDesignFacets(orgId: OrgId, blueprintId: string): Promise<ReadonlyMap<string, string>> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ design_facet_key: string; content: string }>(
        // 租户边界由 RLS 策略保证（见迁移）——这里不再 JOIN blueprints 判 org_id：
        // 那会让「谁负责隔离」有两个答案，而漏写 JOIN 的那一条不会有东西报警。
        `SELECT design_facet_key, content FROM blueprint_design_facets WHERE blueprint_id = $1`,
        [blueprintId],
      );
      return new Map(r.rows.map((row) => [row.design_facet_key, row.content]));
    });
  }

  /**
   * F174（BP-02）：逐项 compare-and-swap，同 `pg-agent-skill-pins-repository.ts`
   * 的先例——`SELECT ... FOR UPDATE` 读快照、应用层比对、再写，而不是
   * `UPDATE ... WHERE revision = $expected`（那种写法在「行不存在」与
   * 「行存在但版本不对」两种情况下都返回 0 行，调用方分不清是哪一种）。
   *
   * ⚠ 空串 value 不是「写一个空字符串」，是**删掉这一行**（未填的表达是没有行，
   *   见 BP-01 文件头注）；删除后返回的 revision 是哨兵 `''`——它自然而然
   *   成了「这一项现在没人填过」状态下的正确 expected 值，不需要特殊分支。
   */
  async updateDesignFacet(cmd: UpdateDesignFacetCommand): Promise<UpdateDesignFacetOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const bp = await s.query<{ id: string }>(
        `SELECT id FROM blueprints WHERE id = $1 FOR UPDATE`,
        [cmd.blueprintId],
      );
      if (bp.rows.length === 0) return { kind: "blueprint-not-found" };

      const existing = await s.query<{ item_revision: string }>(
        `SELECT item_revision FROM blueprint_design_facets
          WHERE blueprint_id = $1 AND design_facet_key = $2 FOR UPDATE`,
        [cmd.blueprintId, cmd.designFacetKey],
      );
      const row = existing.rows[0];

      if (row === undefined) {
        // 从未填过。哨兵之外的任何 expected 值都说明调用方的信念与现实不符
        // （例如它曾经填过、被别处清空了，而调用方还拿着旧 revision）。
        if (cmd.expectedItemRevision !== "") return { kind: "version-changed" };
        if (cmd.value.trim() === "") {
          // 空到空，无事可做——不产生新 revision，也不必产生。
          const count = await this.countFilled(s, cmd.blueprintId);
          return { kind: "ok", itemRevision: "", filledDesignFacetCount: count };
        }
        const inserted = await s.query<{ item_revision: string }>(
          `INSERT INTO blueprint_design_facets (blueprint_id, org_id, design_facet_key, content)
           VALUES ($1, $2, $3, $4) RETURNING item_revision`,
          [cmd.blueprintId, cmd.orgId, cmd.designFacetKey, cmd.value],
        );
        const count = await this.countFilled(s, cmd.blueprintId);
        return { kind: "ok", itemRevision: inserted.rows[0]!.item_revision, filledDesignFacetCount: count };
      }

      if (row.item_revision !== cmd.expectedItemRevision) return { kind: "version-changed" };

      if (cmd.value.trim() === "") {
        await s.query(
          `DELETE FROM blueprint_design_facets WHERE blueprint_id = $1 AND design_facet_key = $2`,
          [cmd.blueprintId, cmd.designFacetKey],
        );
        const count = await this.countFilled(s, cmd.blueprintId);
        return { kind: "ok", itemRevision: "", filledDesignFacetCount: count };
      }

      const updated = await s.query<{ item_revision: string }>(
        `UPDATE blueprint_design_facets SET content = $3, item_revision = gen_random_uuid()::text, updated_at = now()
          WHERE blueprint_id = $1 AND design_facet_key = $2 RETURNING item_revision`,
        [cmd.blueprintId, cmd.designFacetKey, cmd.value],
      );
      const count = await this.countFilled(s, cmd.blueprintId);
      return { kind: "ok", itemRevision: updated.rows[0]!.item_revision, filledDesignFacetCount: count };
    });
  }

  private async countFilled(s: Parameters<Parameters<DatabasePort["withTenant"]>[1]>[0], blueprintId: string): Promise<number> {
    const r = await s.query<{ n: string }>(
      `SELECT count(*) AS n FROM blueprint_design_facets WHERE blueprint_id = $1`,
      [blueprintId],
    );
    return Number(r.rows[0]?.n ?? "0");
  }

  async list(orgId: OrgId, state: BlueprintState | null): Promise<readonly GuardedBlueprint[]> {
    return this.db.withTenant(orgId, async (s) => {
      // 分子（已填项数）在 SQL 侧聚合：列表页 N 个蓝本各取一次完整内容是没必要的读放大。
      // ⚠ 分母不在这里——它来自运行时的设计环节定义表，见 ports 文件头注。
      const r = await s.query<ListRow>(
        `SELECT b.id, b.name, b.state, b.version_number, b.duration_tier,
                (SELECT count(*) FROM blueprint_design_facets f WHERE f.blueprint_id = b.id) AS filled_count
           FROM blueprints b
          WHERE b.org_id = $1
            AND ($2::text IS NULL OR b.state = $2)
          ORDER BY b.created_at DESC`,
        [orgId, state],
      );
      return r.rows.map((row) => ({
        // 判定所需的输入，**不披露**。BP-01 还没有可见性写入路径
        // （契约的 setBlueprintVisibility 是后续 BP），所以此刻全部是组织级、无归属团队——
        // 这是**当前的真实值**，不是占位：没有任何代码能把它写成别的。
        facts: { blueprintId: row.id, scope: "org-wide" as const, ownerTeamId: null },
        listing: guard(
          // 与画布模板同型：`blueprint:<id>`。蓝本是六类 AssetKind 之一（F132），
          // 可见性判定共用 decideCapabilityVisibility，不另造一套。
          { kind: "capability", id: `blueprint:${row.id}` },
          {
        blueprintId: row.id,
        name: row.name,
        state: row.state,
        versionNumber: row.version_number,
        durationTier: row.duration_tier,
        filledDesignFacetCount: Number(row.filled_count),
        // ⚠ 这两个在 BP-01 恒 0，且**不是**编出来的占位数：
        //   · 议程环节：蓝本的议程要等 BP-02「设计环节读写」把 flow-agenda 填进来才有；
        //   · 已套用项目数：要等 BP-08「createProject 带 blueprintVersionId」才会有项目引用蓝本。
        //   在那之前它们的真实值就是 0，不是「未知」。
        agendaSegmentCount: 0,
        appliedProjectCount: 0,
          },
        ),
      }));
    });
  }
}
