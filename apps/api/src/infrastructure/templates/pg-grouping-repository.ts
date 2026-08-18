/**
 * `GroupingRepository` 的 PostgreSQL 实现（F950，delta——F25 签的契约，这是它第一次落库；
 * 此前只有内存假仓储撑单元测试）。
 *
 * ## 三张表，一次事务
 *
 *   `groups`（已有表，本次只加 `scenario`/`status` 两列）——分组本体。
 *   `project_grouping_revision`（新表）——**整批分组**的乐观锁版本号，不挂在 `groups` 上：
 *     `updateGrouping.in.expectedRevision` 校验的是「这一整套分组自上次读取后有没有被
 *     别人改过」，不是某一个组自己的版本，混进 `groups` 会让「改一个组」与
 *     「整批分组的版本」变成同一件事的两种记法。
 *   `project_memberships.group_id`/`project_role`——组长/组员是**既有的关联边**
 *     （`project_memberships` 早就有 `group_id` 外键和四值 `project_role`），不新造
 *     `leaderUserId`/`memberUserIds` 列去重复这份事实。
 *
 * ## 已知限制（诚实声明，不是留白）
 *
 * 组长/组员写入**只更新已经在这个项目里有 `project_memberships` 行的用户**——如果
 * `leaderUserId`/`memberUserIds` 里出现一个从未加入过这个项目的用户 id，这个人**不会**
 * 被静默拉进项目（那是 `addProjectMember`，F125 的活，走它自己的邀请/授权路径，本仓储
 * 不越权代劳）。也不会报错——UPDATE 匹配 0 行不是这个仓储能区分「用户不存在」还是
 * 「用户存在但不在这个组织」的地方。这是一个已知的诚实缺口，不是「以后可能出问题」，
 * 是「现在就会发生但不可见」：前端如果把一个不在项目里的人设成组长，界面会显示提交成功，
 * 但读回来这个人不会出现在组员名单里。留给后续 feature：要么在应用层先校验成员存在性
 * 并补一个契约码，要么把「组员必须先是项目成员」做成显式的前置错误。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  GroupingRepository,
  UpdateGroupingCommand,
  UpdatedGrouping,
} from "../../application/templates/grouping-ports";
import { GroupingRevisionConflictError } from "../../application/templates/grouping-ports";
import type { GroupPatch } from "../../domain/templates/grouping";
import type { OrgId } from "../../domain/org-id";

interface GroupSqlRow {
  id: string;
  name: string;
  scenario: string;
  status: string;
  leader_user_id: string | null;
  member_user_ids: string[] | null;
}

function toGroupPatch(r: GroupSqlRow): GroupPatch {
  return {
    groupId: r.id,
    name: r.name,
    scenario: r.scenario,
    status: r.status,
    leaderUserId: r.leader_user_id,
    memberUserIds: r.member_user_ids ?? [],
  };
}

/** 组内成员的相关子查询：组长（`project_role='groupLead'`）与组员（其余角色）各取一份，
 *  同 `pg-project-list-repository.ts` 里 `TAGS_SUBSELECT` 那种「相关子查询取聚合值」的写法。 */
const MEMBERSHIP_SUBSELECT = `
  (SELECT pm.user_id FROM project_memberships pm
    WHERE pm.group_id = g.id AND pm.project_role = 'groupLead' LIMIT 1) AS leader_user_id,
  (SELECT array_agg(pm.user_id ORDER BY pm.user_id) FROM project_memberships pm
    WHERE pm.group_id = g.id AND pm.project_role <> 'groupLead') AS member_user_ids
`;

export class PgGroupingRepository implements GroupingRepository {
  constructor(private readonly db: DatabasePort) {}

  async updateGrouping(cmd: UpdateGroupingCommand): Promise<UpdatedGrouping> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      // 版本行：第一次写分组时还没有这一行，用 INSERT ... ON CONFLICT DO NOTHING 先确保
      // 存在，再走「按 expectedRevision 条件更新」——同 `pg-project-topic-repository.ts`
      // 「先试着建、建不成就按条件更新」的先例，不是两条语句意外拼出来的巧合。
      await s.query(
        `INSERT INTO project_grouping_revision (project_id, org_id, group_count, revision)
         VALUES ($1, $2, NULL, '0')
         ON CONFLICT (project_id) DO NOTHING`,
        [cmd.projectId, cmd.orgId],
      );
      const bumped = await s.query<{ revision: string }>(
        `UPDATE project_grouping_revision
            SET group_count = $1, revision = (revision::int + 1)::text, updated_at = now()
          WHERE project_id = $2 AND revision = $3
        RETURNING revision`,
        [cmd.groupCount, cmd.projectId, cmd.expectedRevision],
      );
      if (bumped.rows[0] === undefined) throw new GroupingRevisionConflictError();

      for (const g of cmd.groups) {
        await s.query(
          `INSERT INTO groups (id, org_id, project_id, name, scenario, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name, scenario = EXCLUDED.scenario, status = EXCLUDED.status`,
          [g.groupId, cmd.orgId, cmd.projectId, g.name, g.scenario, g.status],
        );

        // 组员/组长的写入范围只在「已经属于这个组」∪「本次要加进来」这个并集里挪动，
        // 不触碰这个项目里跟这个组完全无关的成员行。
        const wanted = g.leaderUserId !== null ? [g.leaderUserId, ...g.memberUserIds] : g.memberUserIds;
        await s.query(
          `UPDATE project_memberships
              SET group_id = NULL
            WHERE project_id = $1 AND group_id = $2 AND user_id <> ALL($3::text[])`,
          [cmd.projectId, g.groupId, wanted],
        );
        if (wanted.length > 0) {
          // 只更新已存在的成员行——见文件头「已知限制」。`project_role` 只在这里改一件事：
          // 把指定的 leader 标成 'groupLead'；组员的既有角色（member/observer）原样保留，
          // 不强行改写成 'member'。
          await s.query(
            `UPDATE project_memberships
                SET group_id = $2,
                    project_role = CASE WHEN user_id = $4 THEN 'groupLead' ELSE project_role END
              WHERE project_id = $1 AND user_id = ANY($3::text[])`,
            [cmd.projectId, g.groupId, wanted, g.leaderUserId],
          );
        }
      }

      const result = await s.query<GroupSqlRow>(
        `SELECT g.id, g.name, g.scenario, g.status, ${MEMBERSHIP_SUBSELECT}
           FROM groups g
          WHERE g.project_id = $1 AND g.kind = 'workshop'
          ORDER BY g.id`,
        [cmd.projectId],
      );
      return { groups: result.rows.map(toGroupPatch), revision: bumped.rows[0].revision };
    });
  }

  async getGrouping(orgId: OrgId, projectId: string): Promise<UpdatedGrouping> {
    return this.db.withTenant(orgId, async (s) => {
      const revisionResult = await s.query<{ revision: string }>(
        `SELECT revision FROM project_grouping_revision WHERE project_id = $1`,
        [projectId],
      );
      const revision = revisionResult.rows[0]?.revision ?? "0";

      const result = await s.query<GroupSqlRow>(
        `SELECT g.id, g.name, g.scenario, g.status, ${MEMBERSHIP_SUBSELECT}
           FROM groups g
          WHERE g.project_id = $1 AND g.kind = 'workshop'
          ORDER BY g.id`,
        [projectId],
      );
      return { groups: result.rows.map(toGroupPatch), revision };
    });
  }
}
