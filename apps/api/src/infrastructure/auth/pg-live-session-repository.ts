/**
 * `LiveSessionRepository` on PostgreSQL —— I-13/I-14 真正住在这个文件里。
 *
 * ## 到场回写为什么是 `INSERT ... ON CONFLICT`，不是「先查再插/改」
 *
 * 迁移 `live_sessions_onsite_participant_uniq` 是一条部分唯一索引：同一名单条目
 * 在同一项目内至多一条 `ended_at IS NULL` 的会话。「先查有没有在场会话，没有就插，
 * 有就更新」在掉线瞬间重开两个标签页时两路都查到「没有」——两条在场会话，
 * 签到板的分子从此多算一个人，且没有任何报错。`ON CONFLICT ... DO UPDATE`
 * 把「新建」与「命中既有」收进同一条语句，恰好一行，与 `invite-links-live-slot-uniq`
 * 同一条理由。
 *
 * ## I-13 为什么是「只 UPDATE 命中的那些 link_id」而不是整个项目
 *
 * 单条撤销只作废那一条链接（I-15 的姊妹条），撤销它名下的在场会话**不得**波及
 * 其余链接进场的人——`WHERE link_id = ANY($linkIds)` 就是这条边界。
 * [重置全部]（`markImmediateEnd`）才按 `(org_id, project_id)` 整项目扫。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  DEFAULT_BASE_URL,
} from "../../application/auth/issue-invite-link";
import type {
  CheckInInput,
  CheckinGroupRow,
  CheckinLinkRow,
  LiveSessionRepository,
  LiveSessionRow,
  MarkImmediateEndInput,
  MarkImmediateEndResult,
  MarkSurvivesUntilStageInput,
  MarkSurvivesUntilStageResult,
} from "../../application/auth/live-session-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { identityChoiceOf, type ProjectRoleValue } from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";

interface SessionDbRow {
  id: string;
  participant_id: string;
  link_id: string;
  group_id: string | null;
  revoked_at: Date | null;
  survives_until_stage_id: string | null;
  ended_at: Date | null;
}

function toRow(r: SessionDbRow): LiveSessionRow {
  return {
    sessionId: r.id,
    participantId: r.participant_id,
    linkId: r.link_id,
    groupId: r.group_id,
    revokedAt: r.revoked_at,
    survivesUntilStageId: r.survives_until_stage_id,
    endedAt: r.ended_at,
  };
}

const SESSION_COLUMNS = `id, participant_id, link_id, group_id, revoked_at, survives_until_stage_id, ended_at`;

export class PgLiveSessionRepository implements LiveSessionRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly newSessionId: () => string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async checkIn(input: CheckInInput): Promise<LiveSessionRow> {
    return this.db.withTenant(input.orgId, async (s) => {
      const res = await s.query<SessionDbRow>(
        `INSERT INTO live_sessions
           (id, org_id, project_id, link_id, participant_id, guest_identity_id, group_id,
            entered_at_stage_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (project_id, participant_id) WHERE ended_at IS NULL
         DO UPDATE SET link_id = EXCLUDED.link_id, guest_identity_id = EXCLUDED.guest_identity_id
         RETURNING ${SESSION_COLUMNS}`,
        [
          this.newSessionId(),
          input.orgId,
          input.projectId,
          input.linkId,
          input.participantId,
          input.guestIdentityId,
          input.groupId,
          input.currentStageId,
          input.now,
        ],
      );
      const row = res.rows[0];
      if (row === undefined) {
        throw new Error(
          `live_sessions checkIn: INSERT ... ON CONFLICT DO UPDATE ... RETURNING 未返回任何行 —— ` +
            `这不应该发生（DO UPDATE 恒匹配它自己刚冲突的那一行）。`,
        );
      }
      return toRow(row);
    });
  }

  async markSurvivesUntilStage(
    input: MarkSurvivesUntilStageInput,
  ): Promise<MarkSurvivesUntilStageResult> {
    if (input.linkIds.length === 0) return { affected: 0, stageId: null };
    return this.db.withTenant(input.orgId, async (s) => {
      const res = await s.query<{ id: string }>(
        `UPDATE live_sessions SET revoked_at = $3, survives_until_stage_id = $4
           WHERE project_id = $1 AND link_id = ANY($2::text[])
             AND ended_at IS NULL AND revoked_at IS NULL
           RETURNING id`,
        [input.projectId, [...input.linkIds], input.now, input.currentStageId],
      );
      const affected = res.rows.length;
      // 契约 `survivesUntilStageId`：null = 无在场会话需要保留。没有受影响的会话，
      // 就没有「保留至哪个环节」这件事可言——即便调用方传了 currentStageId。
      return { affected, stageId: affected > 0 ? input.currentStageId : null };
    });
  }

  async markImmediateEnd(input: MarkImmediateEndInput): Promise<MarkImmediateEndResult> {
    return this.db.withTenant(input.orgId, async (s) => {
      const res = await s.query<{ id: string }>(
        `UPDATE live_sessions SET revoked_at = COALESCE(revoked_at, $2), survives_until_stage_id = NULL,
                ended_at = $2
           WHERE project_id = $1 AND ended_at IS NULL
           RETURNING id`,
        [input.projectId, input.now],
      );
      return { affected: res.rows.length };
    });
  }

  async get(orgId: OrgId, sessionId: string): Promise<LiveSessionRow | undefined> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<SessionDbRow>(
        `SELECT ${SESSION_COLUMNS} FROM live_sessions WHERE id = $1`,
        [sessionId],
      );
      const row = res.rows[0];
      return row === undefined ? undefined : toRow(row);
    });
  }

  async board(orgId: OrgId, projectId: string): Promise<Guarded<readonly CheckinGroupRow[]>> {
    const groups = await this.db.withTenant(orgId, async (s) => {
      const groupRows = await s.query<{ id: string; name: string }>(
        `SELECT id, name FROM groups WHERE project_id = $1 ORDER BY name, id`,
        [projectId],
      );

      const rosterRows = await s.query<{
        group_id: string | null;
        alias: string;
        present: boolean;
      }>(
        `SELECT p.group_id AS group_id,
                COALESCE(p.display_alias, p.masked) AS alias,
                (ls.id IS NOT NULL) AS present
           FROM project_participants p
           LEFT JOIN live_sessions ls
             ON ls.participant_id = p.id AND ls.ended_at IS NULL
          WHERE p.project_id = $1
          ORDER BY p.created_at, p.id`,
        [projectId],
      );

      const linkRows = await s.query<{
        group_id: string | null;
        project_role: ProjectRoleValue;
        token: string;
        invite_code: string | null;
      }>(
        `SELECT group_id, project_role, token, invite_code
           FROM invite_links
          WHERE project_id = $1 AND kind = 'group'
            AND revoked_at IS NULL AND superseded_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())`,
        [projectId],
      );

      const linksByGroup = new Map<string, CheckinLinkRow[]>();
      for (const l of linkRows.rows) {
        if (l.group_id === null) continue;
        const identity = identityChoiceOf(l.project_role);
        const url = `${this.baseUrl}/w/${projectId}/g/${l.group_id}?r=${identity}&t=${l.token}`;
        const list = linksByGroup.get(l.group_id) ?? [];
        list.push({ url, qrPayload: url });
        linksByGroup.set(l.group_id, list);
      }

      return groupRows.rows.map((g): CheckinGroupRow => {
        const roster = rosterRows.rows.filter((r) => r.group_id === g.id);
        return {
          groupId: g.id,
          title: g.name,
          present: roster.filter((r) => r.present).length,
          total: roster.length,
          links: linksByGroup.get(g.id) ?? [],
          roster: roster.map((r) => ({
            alias: r.alias,
            attendance: r.present ? ("present" as const) : ("absent" as const),
          })),
        };
      });
    });

    return guard({ kind: "project", id: projectId }, groups);
  }
}
