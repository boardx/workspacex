/**
 * `ComputeDeviationsRepository` 的 PostgreSQL 实现（F29 补实现 / #1667）。
 *
 * ## `findCurrentProjectContent` 今天诚实能给的，只有 `flow-agenda` 一项
 *
 * `computeDeviations` 要对比「项目当前值」与「绑定的蓝本版本快照」——但**除了
 * 议程环节**，`design-facet-table.ts` 枚举的其余设计配置项（`topic-and-background`
 * / `grouping-rule` / `survey` / ...）在**项目侧**都还没有对应的可编辑存储
 * （F24-F27 尚未落地真实的项目侧配置编辑路径——`survey`/分组/角色矩阵等today全部
 * 停在原型阶段，`phases/phase-01-run-a-project/feature_list.json` 里那几个 feature
 * 虽标 passing，但本 issue #1667 已经证明"passing"不等于"有 controller"）。
 *
 * 议程环节不同：`applyBlueprint`（本 issue 同一批落地）真实把六类初始化的「议程环节」
 * 写进 `agenda_segments` 表，且它本来就是这个项目独立于蓝本草稿之后能改的行
 * （F119 `advanceAgendaSegment` 已经在真实推进它们的状态；标题/时长虽然今天还没有
 * 专门的"编辑"controller，但表本身是活的、可被后续 feature 直接接上编辑端点，
 * 不需要发明新表）。所以本仓储把 `agenda_segments` 现状序列化成与
 * `agenda-panel-editor.tsx` 的 `AgendaContentValue` 相同的 JSON 形状，
 * 与蓝本快照的 `flow-agenda` 值走同一个 `stringifyFacetValue`/字符串比较逻辑，
 * 这样 `computeDeviations` 对 `flow-agenda` 这一项给出的是**真实**diff，不是摆设。
 *
 * 其余各项键**如实原样返回快照值**（= 不产生偏离）——这是诚实的空态（A3 逐字
 * 「不强行凑条目」），不是缺陷；待项目侧对应的配置编辑路径真正落地时，
 * 这里补对应键的读取即可，接口形状不用变。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  ComputeDeviationsRepository,
  ProjectBlueprintBinding,
} from "../../application/templates/compute-deviations-ports";

interface BindingRow {
  blueprint_id: string;
  version_id: string | null;
  content: Record<string, unknown>;
}

interface AgendaRow {
  agenda_segment_definition_id: string | null;
  ordinal: number;
  title: string;
  duration: number | null;
}

export class PgComputeDeviationsRepository implements ComputeDeviationsRepository {
  constructor(private readonly db: DatabasePort) {}

  async findProjectBinding(orgId: OrgId, projectId: string): Promise<ProjectBlueprintBinding | null> {
    return this.db.withTenant(orgId, async (s) => {
      const bindingRes = await s.query<{ blueprint_id: string; version_id: string | null }>(
        `SELECT blueprint_id, version_id FROM blueprint_bindings
          WHERE org_id = $1 AND project_id = $2 AND kind = 'project'
          ORDER BY created_at DESC LIMIT 1`,
        [orgId, projectId],
      );
      const binding = bindingRes.rows[0];
      if (binding === undefined || binding.version_id === null) return null;

      const versionRes = await s.query<{ content: Record<string, unknown> }>(
        `SELECT content FROM blueprint_versions WHERE id = $1`,
        [binding.version_id],
      );
      const version = versionRes.rows[0];
      if (version === undefined) return null;

      return { blueprintId: binding.blueprint_id, baseVersionId: binding.version_id, baseContent: version.content };
    });
  }

  async findCurrentProjectContent(orgId: OrgId, projectId: string): Promise<Readonly<Record<string, unknown>>> {
    return this.db.withTenant(orgId, async (s) => {
      const bindingRes = await s.query<BindingRow>(
        `SELECT b.blueprint_id, b.version_id, COALESCE(v.content, '{}'::jsonb) AS content
           FROM blueprint_bindings b
           LEFT JOIN blueprint_versions v ON v.id = b.version_id
          WHERE b.org_id = $1 AND b.project_id = $2 AND b.kind = 'project'
          ORDER BY b.created_at DESC LIMIT 1`,
        [orgId, projectId],
      );
      const base = bindingRes.rows[0]?.content ?? {};

      const segRes = await s.query<AgendaRow>(
        `SELECT agenda_segment_definition_id, ordinal, title, duration
           FROM agenda_segments WHERE workshop_id = $1 ORDER BY ordinal ASC`,
        [projectId],
      );

      // 没有任何议程环节（还没套用蓝本 / 空白项目）⇒ 对这一项不判定偏离，
      // 保留快照值——「没有数据」不等于「值变了」（A3 同一立场）。
      if (segRes.rows.length === 0) return base;

      const segments = segRes.rows.map((r) => ({
        no: String(r.ordinal + 1).padStart(2, "0"),
        title: r.title,
        min: r.duration ?? undefined,
        boardSkill: "",
        optional: false,
      }));

      return { ...base, "flow-agenda": JSON.stringify({ segments }) };
    });
  }
}
