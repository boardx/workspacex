/**
 * #4615 —— `WhiteboardProjectAccess` 的 PostgreSQL 装配：在白板存储**已经打开的**租户事务里回答
 * 「这个人借项目在这块白板上拿到了什么」。
 *
 * 判定本身不在这里：项目层身份走 `resolveProjectLayer`（经 `PgIdentityRepository`，与 `authorize()` 同一个实现），
 * 映射走 `projectWhiteboardRole`。这里只做两件基础设施的事：
 *   · 读链接行（`project_resource_links.kind = 'whiteboard'`）与所挂项目是否归档；
 *   · 把 `PgIdentityRepository` 绑到**同一个会话**上（`sessionBoundDatabase`），不另开连接——
 *     白板存储已经锁住了白板行，同一事务里读到的「移出项目 / 解挂」就是这次判权依据的那份。
 *
 * 链接行 / 项目行只是判定**据以做出**的容器身份（同 `pg-identity-repository.ts` 读 `project_memberships` 的性质），
 * 不回任何内容，所以用不着 `guard()`——豁免登记在 `scripts/lint-permission-paths.mjs`，前提由
 * `tests/whiteboard/project-access-guard.test.ts` 机械核对（只两张表、只在调用方会话里、从不 withoutTenant）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import {
  resolveWhiteboardProjectRole,
  type BoardProjectLink,
  type WhiteboardProjectAccess,
  type WhiteboardProjectAccessInput,
} from "../../application/whiteboard/project-access";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../../application/identity/ports";
import { PgIdentityRepository } from "../identity/pg-identity-repository";

/**
 * 把一条已开的租户会话包装成 `DatabasePort`：`withTenant(同一个组织)` 直接在这条会话上跑，
 * 不开新事务、不重设 `app.current_org`。组织不一致一律抛——跨租户读永远不该经过这里。
 */
export function sessionBoundDatabase(session: TenantSession, orgId: OrgId): DatabasePort {
  return {
    async withTenant<T>(requested: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
      if (requested !== orgId) throw new Error("session-bound database: tenant mismatch");
      return fn(session);
    },
    async withoutTenant<T>(): Promise<T> {
      throw new Error("session-bound database: global reads are not allowed");
    },
    async close(): Promise<void> {
      /* 会话归调用方所有 */
    },
  };
}

export async function boardProjectLinkIn(
  session: TenantSession,
  orgId: OrgId,
  boardId: string,
): Promise<BoardProjectLink | null> {
  const r = await session.query<{ project_id: string; status: string }>(
    `SELECT l.project_id, p.status
       FROM project_resource_links l
       JOIN projects p ON p.id = l.project_id AND p.org_id = l.org_id
      WHERE l.org_id = $1 AND l.kind = 'whiteboard' AND l.resource_id = $2`,
    [orgId, boardId],
  );
  const row = r.rows[0];
  return row === undefined ? null : { projectId: row.project_id, archived: row.status === "archived" };
}

export class PgWhiteboardProjectAccess implements WhiteboardProjectAccess {
  constructor(
    private readonly identityFor: (db: DatabasePort) => IdentityRepository = (db) => new PgIdentityRepository(db),
  ) {}

  async roleIn(session: TenantSession, input: WhiteboardProjectAccessInput): Promise<"editor" | "viewer" | null> {
    return resolveWhiteboardProjectRole(
      {
        identity: this.identityFor(sessionBoundDatabase(session, input.orgId)),
        boardProject: (orgId, boardId) => boardProjectLinkIn(session, orgId, boardId),
      },
      input,
    );
  }
}
