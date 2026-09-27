/**
 * phase-18 S10（issue #4367）——「分享到项目…」的 Postgres 实现（`ProjectSharePort`）。
 *
 * 读方法都包进 `guard(personalSpaceRef(userId))`：调用方（application/knowledge-graph/share-to-project.ts）
 * 交出个人空间判定（`decidePersonalSpace`：组织层 + 查看者就是空间主人）才拿得到内容。
 * 写只经两个数据库函数（迁移 20260927600000）：主人 / 成员 / 观察者 / 归档都在那里、与写入同一个事务里复核。
 * 每次都设 app.current_user_id = 登录用户：个人空间的行由 RLS 只放给本人（I-14）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import {
  KgShareError, type KgShareErrorCode, type ProjectSharePort,
} from "../../application/knowledge-graph/share-to-project";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import { knowledgeGraph as KG } from "@repo/contracts";
import { personalSpaceRef } from "./pg-knowledge-read";

const LIVE = "c.revoked_at IS NULL AND c.status <> 'superseded'";
const CODES: readonly KgShareErrorCode[] = [
  "KG_CLAIM_NOT_FOUND", "KG_PROJECT_NOT_FOUND", "KG_PROJECT_READ_ONLY", "KG_CONTESTED_NEEDS_RESOLUTION",
  "KG_ACTOR_NOT_HUMAN", "KG_SCOPE_NOT_ENABLED",
];

const rejected = (e: unknown): never => {
  const message = e instanceof Error ? e.message : "";
  const code = CODES.find((c) => message.startsWith(c));
  if (code !== undefined) throw new KgShareError(code, message);
  throw e;
};

export class PgProjectShare implements ProjectSharePort {
  constructor(private readonly db: DatabasePort) {}

  private asUser<T>(orgId: OrgId, userId: string, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return fn(s);
    });
  }

  async ownClaim(orgId: OrgId, userId: string, claimId: string) {
    const r = await this.asUser(orgId, userId, (s) => s.query<{ id: string; statement: string }>(
      `SELECT c.id, c.statement FROM claims c
        WHERE c.org_id = $1 AND c.id = $2 AND c.scope_kind = 'personal' AND c.scope_id = $3 AND ${LIVE}`,
      [orgId, claimId, userId],
    ));
    const row = r.rows[0];
    return row === undefined ? null : guard(personalSpaceRef(userId), { id: row.id, statement: row.statement });
  }

  async shareTargets(orgId: OrgId, userId: string, claimId: string) {
    const targets = await this.asUser(orgId, userId, async (s) => {
      // 本人是成员、不是观察者、项目未归档（与 kg_share_claim_to_project 的判定同一组条件）。
      const projects = await s.query<{ id: string; name: string; shared_claim_id: string | null }>(
        `SELECT p.id, p.name,
                (SELECT pc.id FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
                  WHERE d.org_id = p.org_id AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.dst_id = $3
                    AND d.relation = 'derived_from' AND d.status = 'active'
                    AND pc.scope_kind = 'project' AND pc.scope_id = p.id AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
                  LIMIT 1) AS shared_claim_id
           FROM project_memberships m JOIN projects p ON p.id = m.project_id AND p.org_id = m.org_id
          WHERE m.org_id = $1 AND m.user_id = $2 AND m.project_role <> 'observer' AND p.status <> 'archived'
          ORDER BY p.name, p.id`,
        [orgId, userId, claimId],
      );
      if (projects.rows.length === 0) return [];
      // 范围预览：每个项目的全体成员（含观察者——项目记忆给全体成员看），显示名取自 credentials。
      const members = await s.query<{ project_id: string; user_id: string; display_name: string | null }>(
        `SELECT m.project_id, m.user_id, cr.display_name
           FROM project_memberships m LEFT JOIN credentials cr ON cr.user_id = m.user_id
          WHERE m.org_id = $1 AND m.project_id = ANY($2::text[])
          ORDER BY m.project_id, coalesce(cr.display_name, m.user_id), m.user_id`,
        [orgId, projects.rows.map((p) => p.id)],
      );
      return projects.rows.map((p) => {
        const all = members.rows.filter((m) => m.project_id === p.id);
        return {
          projectId: p.id, name: p.name, sharedClaimId: p.shared_claim_id, audienceCount: all.length,
          audience: all.slice(0, KG.KG_SHARE_AUDIENCE_PREVIEW_MAX).map((m) => ({ userId: m.user_id, displayName: m.display_name ?? m.user_id })),
        };
      });
    });
    return guard(personalSpaceRef(userId), targets);
  }

  async share(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly projectId: string }) {
    try {
      const r = await this.asUser(orgId, userId, (s) => s.query<{ r: { project_claim_id: string; outcome: "shared" | "already_shared" } }>(
        "SELECT kg_share_claim_to_project($1::jsonb) AS r",
        [JSON.stringify({ action_id: input.actionId, claim_id: input.claimId, project_id: input.projectId })],
      ));
      const out = r.rows[0]!.r;
      return { projectClaimId: out.project_claim_id, outcome: out.outcome };
    } catch (e) {
      return rejected(e);
    }
  }

  async unshare(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly projectId: string }) {
    try {
      const r = await this.asUser(orgId, userId, (s) => s.query<{ id: string }>(
        "SELECT kg_unshare_claim_from_project($1::jsonb) AS id",
        [JSON.stringify({ action_id: input.actionId, claim_id: input.claimId, project_id: input.projectId })],
      ));
      return r.rows[0]!.id;
    } catch (e) {
      return rejected(e);
    }
  }
}
