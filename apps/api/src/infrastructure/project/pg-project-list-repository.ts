/**
 * `ProjectListRepository` 的 PostgreSQL 实现 —— F122 / UC-P2 两段式列表。
 *
 * ## 为什么是**独立文件**，不是加进 `pg-project-repository.ts`
 *
 * 那个文件在 `lint-permission-paths.mjs` 的白名单里，理由是「写入路径 + 一条
 * actor 限定的回声 SELECT」，`tests/project/create-project-idempotent.test.ts`
 * 有一条断言钉死它**只能有一条 SELECT**。两段列表查询需要至少两条新 SELECT，
 * 塞进那个文件会让「只有一条回声 SELECT」这条断言失去意义。新文件、新的
 * 白名单条目（`apps/api/scripts/lint-permission-paths.mjs`），各自的豁免各自成立。
 *
 * ## 为什么这里**不走** `guard()` / `disclose()`（`permission-filter.ts`）
 *
 * 那条门是为「一个 Artifact/Segment 的可见性由 `acl_bindings` 决定」这类场景设计的：
 * 一个 `ObjectRef` 对应一个由 `authorize()` 判的 scope。而 `listProjects` 的两段
 * 判据根本不是 `acl_bindings`——是 `project_memberships`（`member` 段）与
 * `org_memberships.org_role`（`managed` 段）本身，即**判定所依据的身份数据**，
 * 与 `pg-identity-repository.ts` 在同一份白名单里的理由完全同型：
 * 「reads the memberships ... the decision is MADE from -- guarding it with the
 * decision would be circular」。
 *
 * 且 D-18 边界已经把「出现在 managed 段」与「能读内容」明确分开：本文件返回的
 * 五个字段（`id/name/kind/status/orgStatus`）没有一个是**内容**，`acl_bindings`
 * 保护的是内容读取，不是「这个容器存在且我在管理它」这件事本身。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ListProjectsForActorQuery,
  ProjectListRepository,
  ProjectListRow,
} from "../../application/project/ports";
import type { ProjectKind } from "../../domain/project/create-project-rules";

interface ProjectListSqlRow {
  id: string;
  name: string;
  kind: ProjectKind;
  status: "active" | "archived";
  org_status: "active" | "disabled";
}

function toListRow(r: ProjectListSqlRow): ProjectListRow {
  return { id: r.id, name: r.name, kind: r.kind, status: r.status, orgStatus: r.org_status };
}

export class PgProjectListRepository implements ProjectListRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 两段各自一条 SQL，同一个事务（`withTenant` 一次调用，仅为了共用 RLS 会话，
   * 两段之间没有需要原子性的写操作——本方法整个是只读的）。
   *
   * ⚠ `managed` 段只在 `isManager` 为真时才查：见 `ports.ts` 上那条注释——
   *   「不查」和「查了返回空」在响应体上故意同形，但仓储层不该为一个必然是 `[]`
   *   的结果多打一次全表扫描。
   *
   * `org.status` 随每一行一起查出来（JOIN `organizations`），供 application 层的
   * `deriveReadOnlyReason` 判定——本仓储**不**在 SQL 里判定只读原因，那是纯判断，
   * 应该住在 domain 层，可以脱离数据库单测（同 `create-project-rules.ts` 的理由）。
   */
  async listForActor(
    query: ListProjectsForActorQuery,
  ): Promise<{ member: readonly ProjectListRow[]; managed: readonly ProjectListRow[] }> {
    return this.db.withTenant(query.orgId, async (s) => {
      const memberResult = await s.query<ProjectListSqlRow>(
        `SELECT DISTINCT p.id, p.name, p.kind, p.status, o.status AS org_status
           FROM projects p
           JOIN project_memberships pm ON pm.project_id = p.id
           JOIN organizations o ON o.id = p.org_id
          WHERE pm.user_id = $1 AND p.org_id = $2
          ORDER BY p.id`,
        [query.actorId, query.orgId],
      );

      let managedRows: ProjectListSqlRow[] = [];
      if (query.isManager) {
        const managedResult = await s.query<ProjectListSqlRow>(
          `SELECT p.id, p.name, p.kind, p.status, o.status AS org_status
             FROM projects p
             JOIN organizations o ON o.id = p.org_id
            WHERE p.org_id = $1
            ORDER BY p.id`,
          [query.orgId],
        );
        managedRows = managedResult.rows;
      }

      return {
        member: memberResult.rows.map(toListRow),
        managed: managedRows.map(toListRow),
      };
    });
  }
}
