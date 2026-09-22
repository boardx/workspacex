/**
 * `CanvasSegmentSkillRepository` 的 PostgreSQL 实现（#1468）。
 *
 * ## 每一条查询都在 `withTenant` 里
 *
 * 隔离由 PG 的 RLS 强制（`canvas_segment_skill_bindings_tenant`），SQL 里那句
 * `WHERE org_id = $1` 是第二道，不是第一道。本文件**不使用** `withoutTenant`——同
 * `pg-canvas-template-repository.ts` 文件头的理由，不复述。
 *
 * ## 出门是 `Guarded<T>`
 *
 * `listBindings` 的每一行都经 `guard()` 包住，ref 是 `{kind:"project", id: workshopId}`：
 * `displayName` 来自 `skills` 表，是租户内容，不能以裸行的形态离开 infrastructure。
 * 解封在 `application/canvas/list-segment-skills.ts`，用那条用例自己 `authorize()` 出来的
 * 决定（`discloseDecided`）——议程环节没有 `acl_bindings` 行，走 `disclose()` 会查不到
 * 绑定、退回宽松默认 scope，那正是 `permission-filter` 文件头点名的静默放行。
 *
 * ## `skills` 是 LEFT JOIN，不是 INNER
 *
 * INNER JOIN 会让「绑了一个今天查不到的 skillKey」这条绑定**从白名单里消失**，而
 * `runSegmentSkill` 判的是绑定不是名字——那会造出一个列表里没有、却能跑的 skill。
 * 判据与理由在 `domain/canvas/segment-binding.ts` 的 `projectSegmentSkillWhitelist`，
 * 这里只负责把 `null` 如实带出去，不在 SQL 里 `COALESCE` 成 key（那等于把同一条判定
 * 抄到第二个地方，且抄在一个测试读不到的字符串里）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  CanvasSegmentSkillRepository,
  SegmentSkillRow,
  UpsertSegmentSkillOutcome,
} from "../../application/canvas/segment-skill-ports";
import type { SegmentSkillRunMode } from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";

interface BindingRecord {
  id: string;
  skill_key: string;
  display_name: string | null;
  run_mode: string;
  last_run_at: Date | null;
}

export class PgCanvasSegmentSkillRepository implements CanvasSegmentSkillRepository {
  constructor(private readonly db: DatabasePort) {}

  async listBindings(
    orgId: OrgId,
    agendaSegmentId: string,
    workshopId: string,
  ): Promise<readonly Guarded<SegmentSkillRow>[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<BindingRecord>(
        `SELECT b.id,
                b.skill_key,
                sk.name AS display_name,
                b.run_mode,
                b.last_run_at
           FROM canvas_segment_skill_bindings b
           LEFT JOIN skills sk
             ON sk.org_id = b.org_id AND sk.stable_name = b.skill_key
          WHERE b.org_id = $1 AND b.agenda_segment_id = $2
          ORDER BY b.skill_key`,
        [orgId, agendaSegmentId],
      );
      return r.rows.map((row) =>
        guard<SegmentSkillRow>(
          { kind: "project", id: workshopId },
          {
            bindingId: row.id,
            skillKey: row.skill_key,
            displayName: row.display_name,
            // 列上有 CHECK (run_mode IN ('once','always-on'))，所以这个断言不是许愿：
            // 写入侧也只接受契约 zod 校验过的两个值，库里不可能出现第三种。
            runMode: row.run_mode as SegmentSkillRunMode,
            lastRunAt: row.last_run_at === null ? null : row.last_run_at.toISOString(),
          },
        ),
      );
    });
  }

  /**
   * ⚠ `xmax = 0` 是「这一行是本语句**插入**的」的判据。
   *   `ON CONFLICT DO UPDATE` 的 `RETURNING` 对插入和更新都回行，两者在响应上完全同形；
   *   插入的新行 `xmax` 为 0，被本事务更新过的既有行则带着一个非零的删除事务 id。
   *   没有它，`created` 只能靠「先查一次」来猜——而那正是这条语句避免的先查后写。
   */
  async upsertBinding(cmd: {
    readonly orgId: OrgId;
    readonly bindingId: string;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly skillKey: string;
    readonly runMode: SegmentSkillRunMode;
  }): Promise<UpsertSegmentSkillOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{ id: string; created: boolean }>(
        `INSERT INTO canvas_segment_skill_bindings
           (id, org_id, agenda_segment_id, workshop_id, skill_key, run_mode)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ON CONSTRAINT canvas_segment_skill_bindings_segment_skill_uniq
         DO UPDATE SET run_mode = EXCLUDED.run_mode, updated_at = now()
         RETURNING id, (xmax = 0) AS created`,
        [
          cmd.bindingId, cmd.orgId, cmd.agendaSegmentId, cmd.workshopId,
          cmd.skillKey, cmd.runMode,
        ],
      );
      const row = r.rows[0];
      // 一条 upsert 必然回一行；回不出来说明 RLS 把写挡了（`WITH CHECK` 不匹配），
      // 那不是「没有变化」，是一次被拒绝的写，不能悄悄当成成功。
      if (row === undefined) throw new Error("upsertBinding returned no row");
      return { bindingId: row.id, created: row.created };
    });
  }
}
