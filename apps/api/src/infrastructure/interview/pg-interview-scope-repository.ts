/**
 * PostgreSQL 实现 —— **本 feature 的服务端过滤就在这一个文件里**。
 *
 * 每次查询都走 `withTenant`，所以 RLS 是第一道线、`org_id` 谓词是第二道。
 * 但 RLS 只管租户，管不了同一组织内的两种投影 —— 那是 `VISIBILITY_PREDICATE`。
 *
 * ## 为什么谓词是一个导出的常量
 *
 * 为了让「把服务端过滤去掉」是一个**具体的、可执行的动作**：删掉 `VISIBILITY_PREDICATE`
 * 在三处 SQL 里的引用，再跑 `scope-server-side-filter-no-leak.test.ts`，它必须当场红。
 * 反证做不出来的门控就是空转的门控，本项目已经栽过九次。
 *
 * 同一个常量被 list / count / byId 三处共用，也是为了不让它们各写一份 ——
 * 「列表过滤对了、直读漏了」是这类 bug 最常见的形态，因为直读那条路径通常只有一个
 * 「找到了就返回」的 happy path。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  GuardedInterviewRow,
  InterviewScopeRepository,
  ListVisibleInput,
  ListVisiblePage,
  StoredInterviewRow,
} from "../../application/interview/ports";
import { guard } from "../../application/security/permission-filter";
import type { InterviewSourceKindName } from "../../domain/interview/scope";
import type { OrgId } from "../../domain/org-id";

/**
 * 两种投影，逐字对应 `domain/interview/scope.ts` 的 `canRead`。
 *
 *   创建者                                      —— 两种投影都有
 *   ∨ 显式协作者                                 —— 两种投影都有
 *   ∨ (项目非空 ∧ 看的人是该项目成员)             —— **只有第二种投影有**
 *
 * 第三支的 `s.project_id IS NOT NULL` 不是多余的：`project_memberships` 里
 * `project_id` 非空，`NULL = 'x'` 求值为 NULL 而不是 true，所以理论上它自己会落空。
 * 写出来是因为 I-31 的整条命必挂在它上面，而一条靠 NULL 语义**恰好**成立的规则，
 * 下一个人重写这段 SQL 时不会知道自己动的是什么。
 *
 * $1 = orgId, $2 = viewerUserId
 */
export const VISIBILITY_PREDICATE = `(
     s.created_by = $2
  OR EXISTS (
       SELECT 1 FROM interview_collaborators ic
        WHERE ic.interview_id = s.id AND ic.org_id = $1 AND ic.user_id = $2
     )
  OR (
       s.project_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM project_memberships pm
          WHERE pm.org_id = $1 AND pm.project_id = s.project_id AND pm.user_id = $2
       )
     )
)`;

/**
 * 每一行都带着**判定所需的三项事实**一起回来。
 *
 * `is_collaborator` 是在同一条查询里算出来的，而不是回到进程里再查一次：
 * 两次查询之间协作者被移除，就会出现「按 A 时刻的事实判定、发 B 时刻的内容」。
 */
const FACT_COLUMNS = `
  s.created_by,
  EXISTS (
    SELECT 1 FROM interview_collaborators ic2
     WHERE ic2.interview_id = s.id AND ic2.org_id = $1 AND ic2.user_id = $2
  ) AS is_collaborator`;

interface SessionRowShape {
  id: string;
  title: string;
  source_kind: string;
  project_id: string | null;
  research_project_id: string | null;
  tags: string[];
  archived: boolean;
  when_at: Date | null;
  created_at: Date;
  created_by: string;
  is_collaborator: boolean;
}

const toRow = (r: SessionRowShape): StoredInterviewRow => ({
  interviewId: r.id,
  title: r.title,
  sourceKind: r.source_kind as InterviewSourceKindName,
  projectId: r.project_id,
  researchProjectId: r.research_project_id,
  tags: r.tags,
  archived: r.archived,
  whenAt: r.when_at === null ? null : r.when_at.toISOString(),
});

/**
 * 包成 `Guarded<T>`：从这里开始，载荷只能经 `discloseDecided` 取出。
 *
 * `ref.kind` 是 `"interview"`，而 `interview` **不在** `AclObjectRef` 里 ——
 * 所以「顺手交给 `disclose()` 判一下」是编译错误，不是一次退回宽松默认 scope 的静默放行。
 * `sources` 留空：一场访谈是一等对象，权限不派生自别的东西。
 */
const toGuarded = (r: SessionRowShape): GuardedInterviewRow => ({
  item: guard({ kind: "interview", id: r.id }, toRow(r)),
  facts: {
    projectId: r.project_id,
    createdBy: r.created_by,
    isExplicitCollaborator: r.is_collaborator,
  },
});

/**
 * 游标 = 上一页最后一行的 `created_at|id`。
 *
 * 不是 OFFSET：OFFSET 分页在两页之间插入一行时会漏掉一行，而漏掉的那一行
 * 在一个「列表是否完整」本身就是验收项的接口里，看起来和「被过滤掉了」一模一样。
 */
function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined || cursor === "") return null;
  const i = cursor.lastIndexOf("|");
  if (i <= 0) return null;
  return { at: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

export class PgInterviewScopeRepository implements InterviewScopeRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 范围档位 ⇒ SQL 谓词。
   *
   * `none` 是 `project_id IS NULL AND research_project_id IS NULL` —— 两个都要判。
   * 只判前一个的话，一场挂在研究项目上的访谈会同时出现在「研究项目」和「不属于任何项目」
   * 两个档位里，而 V1 要求「两次集合不相交」。
   */
  private scopeClause(scope: ListVisibleInput["scope"], params: unknown[]): string {
    switch (scope.kind) {
      case "project":
        params.push(scope.projectId);
        return `s.project_id = $${params.length}`;
      case "research":
        params.push(scope.researchProjectId);
        return `s.research_project_id = $${params.length}`;
      case "none":
        return "s.project_id IS NULL AND s.research_project_id IS NULL";
    }
  }

  async listVisible(input: ListVisibleInput): Promise<ListVisiblePage> {
    return this.db.withTenant(input.orgId, async (s) => {
      const params: unknown[] = [input.orgId, input.viewerUserId];
      const where = [`s.org_id = $1`, VISIBILITY_PREDICATE, this.scopeClause(input.scope, params)];

      if (input.filters?.archived !== undefined && input.filters.archived !== null) {
        params.push(input.filters.archived);
        where.push(`s.archived = $${params.length}`);
      }
      if (input.filters?.tags !== undefined && input.filters.tags !== null && input.filters.tags.length > 0) {
        params.push([...input.filters.tags]);
        where.push(`s.tags && $${params.length}::text[]`);
      }

      // counts 在**分页之前**统计，因为「真人 N 位 / 虚拟 M 条」是关于这个范围的事实，
      // 不是关于当前这一页的。放在分页之后，翻到第二页时这两个数会静默变小。
      const countSql = `
        SELECT
          count(*) FILTER (WHERE s.source_kind = 'human')::text   AS human,
          count(*) FILTER (WHERE s.source_kind = 'virtual')::text AS virtual
        FROM interview_sessions s
        WHERE ${where.join(" AND ")}`;
      const counted = await s.query<{ human: string; virtual: string }>(countSql, params);

      const pageParams = [...params];
      const cur = decodeCursor(input.cursor);
      if (cur !== null) {
        pageParams.push(cur.at, cur.id);
        where.push(
          `(s.created_at, s.id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length})`,
        );
      }
      // limit + 1：多取一行只为回答「还有没有下一页」，那一行**不进 items**。
      pageParams.push(input.limit + 1);
      const rowsSql = `
        SELECT s.id, s.title, s.source_kind, s.project_id, s.research_project_id,
               s.tags, s.archived, s.when_at, s.created_at,
               ${FACT_COLUMNS}
          FROM interview_sessions s
         WHERE ${where.join(" AND ")}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT $${pageParams.length}`;
      const got = await s.query<SessionRowShape>(rowsSql, pageParams);

      const hasMore = got.rows.length > input.limit;
      const page = hasMore ? got.rows.slice(0, input.limit) : got.rows;
      const last = page[page.length - 1];
      return {
        rows: page.map(toGuarded),
        nextCursor: hasMore && last !== undefined ? `${last.created_at.toISOString()}|${last.id}` : null,
        counts: {
          human: Number(counted.rows[0]?.human ?? "0"),
          virtual: Number(counted.rows[0]?.virtual ?? "0"),
        },
      };
    });
  }

  async findVisibleById(
    orgId: OrgId,
    viewerUserId: string,
    interviewId: string,
  ): Promise<GuardedInterviewRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      // ⚠ 可见性谓词与 id 谓词在**同一条 WHERE 里**。
      // 「先按 id 取回来，再判能不能看」在功能上等价，但那一瞬间这一行已经在进程内存里了 ——
      // 而任何一个后来加的日志、错误信息或调试分支都能把它漏出去。
      const r = await s.query<SessionRowShape>(
        `SELECT s.id, s.title, s.source_kind, s.project_id, s.research_project_id,
                s.tags, s.archived, s.when_at, s.created_at,
                ${FACT_COLUMNS}
           FROM interview_sessions s
          WHERE s.org_id = $1 AND s.id = $3 AND ${VISIBILITY_PREDICATE}`,
        [orgId, viewerUserId, interviewId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toGuarded(row);
    });
  }

  async projectIdsOf(orgId: OrgId, userId: string): Promise<string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_id: string }>(
        `SELECT project_id FROM project_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      return r.rows.map((x) => x.project_id);
    });
  }

  async orgMembershipOf(
    orgId: OrgId,
    userId: string,
  ): Promise<{ orgRole: string | null; teamId: string | null }> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ org_role: string; team_id: string | null }>(
        `SELECT org_role, team_id FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      const row = r.rows[0];
      return { orgRole: row?.org_role ?? null, teamId: row?.team_id ?? null };
    });
  }
}
