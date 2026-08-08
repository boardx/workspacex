/**
 * `TeamRepository` on PostgreSQL（F11 / O-29 ④）。
 *
 * ⚠ 本文件点名了 `teams`、`org_memberships`、`acl_bindings`（占用校验读它们），
 * 因此与 `pg-org-invite-repository.ts` 同一处境，需要在 `lint-permission-paths` 的
 * ALLOWLIST 上——这里判的是「删除前占用校验」，不是「requester 能不能看这个团队」，
 * 越权判定已经在用例层的 `actorOrgRole !== "admin"` 做过；用 `guard()` 包一层会是
 * 一个只为过门控套的壳。
 */
import { randomBytes } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  MutateTeamResult,
  TeamListRow,
  TeamOccupancyItem,
  TeamRepository,
} from "../../application/auth/team-ports";
import type { OrgId } from "../../domain/org-id";

/** 事务内抛、事务外接（同 `pg-org-invite-repository.ts` 的 `Rollback`）。 */
class Rollback extends Error {
  constructor(readonly reason: "not-found") {
    super(reason);
  }
}

function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

/** 团队 id。不可从名字推导：改名不改 id 是本用例的一条不变量，两者必须无关联。 */
function newTeamId(): string {
  return `team-${randomBytes(12).toString("hex")}`;
}

export class PgTeamRepository implements TeamRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(orgId: OrgId, name: string): Promise<MutateTeamResult> {
    return this.db.withTenant(orgId, async (s) => {
      // SAVEPOINT，不是裸 try/catch —— 同一条理由：一次唯一键冲突会把整个事务置为
      // aborted，之后想再查一次「既有那个团队长什么样」会先撞 `current transaction
      // is aborted`（`pg-org-invite-repository.ts` 头部记录过同一个坑）。
      await s.query("SAVEPOINT try_insert_team");
      const id = newTeamId();
      try {
        await s.query(`INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)`, [id, orgId, name]);
        return { ok: true as const, team: { teamId: id, name } };
      } catch (e) {
        await s.query("ROLLBACK TO SAVEPOINT try_insert_team");
        if (uniqueViolationConstraint(e) !== "teams_org_name_uniq") throw e;
        // 幂等重放：同名返回既有 team，不新建第二行（usecases.md 逐字）。
        const existing = await s.query<{ id: string; name: string }>(
          `SELECT id, name FROM teams WHERE org_id = $1 AND name = $2`,
          [orgId, name],
        );
        const row = existing.rows[0];
        // 这一行按理必然存在（撞的就是这条唯一索引），但仍显式处理不存在的极端情况，
        // 而不是让下一行对 `undefined` 解引用崩溃。
        if (row === undefined) throw e;
        return { ok: true as const, team: { teamId: row.id, name: row.name } };
      }
    });
  }

  async rename(orgId: OrgId, teamId: string, name: string): Promise<MutateTeamResult> {
    try {
      return await this.db.withTenant(orgId, async (s) => {
        // rename 不改 id（domain.md 逐字）；已有 `acl_binding` 引用的是 id，不受影响。
        const res = await s.query<{ id: string; name: string }>(
          `UPDATE teams SET name = $2 WHERE id = $1 RETURNING id, name`,
          [teamId, name],
        );
        const row = res.rows[0];
        if (row === undefined) throw new Rollback("not-found");
        return { ok: true as const, team: { teamId: row.id, name: row.name } };
      });
    } catch (e) {
      if (e instanceof Rollback) return { ok: false, reason: e.reason };
      throw e;
    }
  }

  async delete(orgId: OrgId, teamId: string): Promise<MutateTeamResult> {
    try {
      return await this.db.withTenant(orgId, (s) => this.deleteOne(s, orgId, teamId));
    } catch (e) {
      if (e instanceof Rollback) return { ok: false, reason: e.reason };
      throw e;
    }
  }

  private async deleteOne(s: TenantSession, orgId: OrgId, teamId: string) {
    const existing = await s.query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE id = $1 FOR UPDATE`,
      [teamId],
    );
    const team = existing.rows[0];
    if (team === undefined) throw new Rollback("not-found");

    // I-7：删除前占用校验。两类占用者，**列出**而不是只报数——一个只说「删不掉」的
    // 错误会让管理员去猜是谁在用。
    const members = await s.query<{ user_id: string; email: string | null }>(
      `SELECT m.user_id, c.email FROM org_memberships m
         LEFT JOIN credentials c ON c.user_id = m.user_id
        WHERE m.org_id = $1 AND m.team_id = $2`,
      [orgId, teamId],
    );
    const bindings = await s.query<{ id: string; object_kind: string; object_id: string }>(
      `SELECT id, object_kind, object_id FROM acl_bindings WHERE org_id = $1 AND owner_team_id = $2`,
      [orgId, teamId],
    );

    if (members.rows.length > 0 || bindings.rows.length > 0) {
      const items: TeamOccupancyItem[] = [
        ...members.rows.map((m) => ({
          kind: "member",
          id: m.user_id,
          label: m.email ?? m.user_id,
        })),
        // ⚠ `label` 在这一半是粗粒度的（`object_kind:object_id`），不是发明一个好看的
        // 名字——项目/artifact 的友好名字解析不在本 feature 范围内，一个编出来的名字
        // 会比「看起来不完整但如实」更容易让人误判占用项是什么。这是记录的取舍，不是缺陷。
        ...bindings.rows.map((b) => ({
          kind: b.object_kind,
          id: b.object_id,
          label: `${b.object_kind}:${b.object_id}`,
        })),
      ];
      return {
        ok: false as const,
        reason: "in-use" as const,
        occupancy: {
          memberCount: members.rows.length,
          aclBindingCount: bindings.rows.length,
          items,
        },
      };
    }

    await s.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    return { ok: true as const, team: null };
  }

  /**
   * `listTeams`（#639 delta，迭代 1）。`memberCount` 是**真查询**
   * （`COUNT(*) FROM org_memberships WHERE team_id = $1`），左连接聚合，不维护第二份计数列——
   * 反证 C：造一个有成员的团队，这里必须回传非 0。
   */
  async list(orgId: OrgId): Promise<readonly TeamListRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{ id: string; name: string; member_count: string }>(
        `SELECT t.id, t.name, COUNT(m.user_id)::text AS member_count
           FROM teams t
           LEFT JOIN org_memberships m ON m.org_id = t.org_id AND m.team_id = t.id
          WHERE t.org_id = $1
          GROUP BY t.id, t.name
          ORDER BY t.name`,
        [orgId],
      );
      return res.rows.map((r) => ({ teamId: r.id, name: r.name, memberCount: Number(r.member_count) }));
    });
  }
}
