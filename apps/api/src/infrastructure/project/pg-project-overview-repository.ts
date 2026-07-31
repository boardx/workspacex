/**
 * `ProjectOverviewRepository` 的 PostgreSQL 实现 —— F123 / UC-P3 概览白名单四件的
 * 后三件（容器身份、当前议程环节、四类角色人数）。第四件（回流列表）**不在这个文件里**：
 * 它复用 `PgBindingRepository` 经 `listBackflow` 读取，本文件不重复那条查询。
 *
 * ## `lint-permission-paths.mjs` 豁免
 *
 * 本文件读 `projects` / `agenda_segments` / `project_memberships` 三张租户表，均不经
 * `guard()`/`disclose()`。理由与 `pg-project-list-repository.ts` 的豁免同型但不相同：
 *
 *   1. 本文件返回的三样东西都不是 `acl_bindings` 治理的**内容**——容器自己的
 *      名字/kind/状态、议程环节的调度元数据、按角色分组的**计数**，没有一个是
 *      Artifact/Segment 内容。D-18 边界已经把「容器身份」与「内容读取」分开，
 *      `acl_bindings` 保护的是后者。
 *   2. 调用方 `get-project-overview.ts` 在调本仓储**之前**已经用 `authorize()`
 *      对同一个 `{kind:"project", id}` 对象判过一次「你能不能看这个项目」——
 *      本文件只在那道门放行之后才被调用，不是暴露给未判定请求的第二条门缝。
 *   3. `project_memberships` 本身正是 `authorize()`/`decide()` 用来**做**判断的
 *      身份数据（同 `pg-identity-repository.ts` 的豁免："reads the memberships
 *      the decision is MADE from -- guarding it with the decision would be circular"）——
 *      这里只是从另一个角度读它（分组计数，不是逐行判定）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  OverviewAgendaSegment,
  OverviewRoleCounts,
  ProjectOverviewRepository,
  ProjectSnapshotRow,
} from "../../application/project/ports";
import type { ProjectKind } from "../../domain/project/create-project-rules";
import type { OrgId } from "../../domain/org-id";

interface ProjectSnapshotSqlRow {
  name: string;
  kind: ProjectKind;
  status: "active" | "archived";
}

interface AgendaSegmentSqlRow {
  id: string;
  workshop_id: string;
  agenda_segment_definition_id: string | null;
  ordinal: number;
  title: string;
  duration: number;
  state: "pending" | "active" | "closed" | "skipped";
  merged_into: string | null;
  accepted_sources: string[];
}

interface RoleCountSqlRow {
  project_role: "facilitator" | "groupLead" | "member" | "observer";
  cnt: number;
}

function toAgendaSegment(r: AgendaSegmentSqlRow): OverviewAgendaSegment {
  return {
    id: r.id,
    workshopId: r.workshop_id,
    agendaSegmentDefinitionId: r.agenda_segment_definition_id,
    ordinal: r.ordinal,
    title: r.title,
    duration: r.duration,
    state: r.state,
    mergedInto: r.merged_into,
    acceptedSources: r.accepted_sources as OverviewAgendaSegment["acceptedSources"],
  };
}

const ZERO_ROLE_COUNTS: OverviewRoleCounts = {
  facilitator: 0,
  groupLead: 0,
  member: 0,
  observer: 0,
};

export class PgProjectOverviewRepository implements ProjectOverviewRepository {
  constructor(private readonly db: DatabasePort) {}

  async getProjectSnapshot(orgId: OrgId, projectId: string): Promise<ProjectSnapshotRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<ProjectSnapshotSqlRow>(
        `SELECT name, kind, status FROM projects WHERE id = $1`,
        [projectId],
      );
      const row = result.rows[0];
      return row === undefined ? null : { name: row.name, kind: row.kind, status: row.status };
    });
  }

  async getCurrentAgendaSegment(
    orgId: OrgId,
    workshopId: string,
  ): Promise<OverviewAgendaSegment | null> {
    return this.db.withTenant(orgId, async (s) => {
      // I-P44 的部分唯一索引保证同一工作坊至多一条 `state='active'`——这里不需要
      // 应用层再去重，`LIMIT 1` 只是给这条不变量的读端一个防御性上限。
      const result = await s.query<AgendaSegmentSqlRow>(
        `SELECT id, workshop_id, agenda_segment_definition_id, ordinal, title, duration,
                state, merged_into, accepted_sources
           FROM agenda_segments
          WHERE workshop_id = $1 AND state = 'active'
          LIMIT 1`,
        [workshopId],
      );
      const row = result.rows[0];
      return row === undefined ? null : toAgendaSegment(row);
    });
  }

  async getWorkshopRoleCounts(orgId: OrgId, projectId: string): Promise<OverviewRoleCounts> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<RoleCountSqlRow>(
        `SELECT project_role, count(*)::int AS cnt
           FROM project_memberships
          WHERE project_id = $1
          GROUP BY project_role`,
        [projectId],
      );
      // 没有任何成员时这里是 0 行——四个计数皆为 0，不是缺字段（`ports.ts` 上那条注释）。
      const counts = { ...ZERO_ROLE_COUNTS };
      for (const row of result.rows) {
        counts[row.project_role] = row.cnt;
      }
      return counts;
    });
  }
}
