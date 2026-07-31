/**
 * `ChatPresetRepository` 的 PostgreSQL 实现（F115 · uc-8-4）。
 *
 * 同 `pg-chat-repository.ts` 的既有纪律：每个查询经 `withTenant`（RLS 第一道，
 * WHERE 里的 org_id 第二道），本文件**不做**任何可见性判定——那属于 application
 * 层（`get-preset-usage.ts` 的项目成员判定、实例可见性走既有 F108 路径）。
 *
 * ⚠ `findOutOfScopeResource` / `countDispatchTargets` / `isActorDispatchTarget` 的
 *   已知简化见迁移文件 `20260731170006_f115_preset_conversation_distribution.sql`
 *   与 `application/chat/dispatch-preset.ts` 的文件头——三处指向同一个缺口
 *   （F15 组织级 agent/skill 可见性范围尚未落地）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ChatPresetRepository,
  NewThreadInput,
  PresetDispatchRecord,
  PresetInstanceRecord,
  PresetRecord,
  UpsertPresetOutcome,
  UpsertPresetRepoInput,
} from "../../application/chat/ports";
import type { OrgId } from "../../domain/org-id";

interface PresetDbRow {
  id: string;
  project_id: string;
  opening_prompt: string;
  skills: string[];
  agents: string[];
  version: number;
  created_by: string;
}

function toPresetRecord(row: PresetDbRow): PresetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    openingPrompt: row.opening_prompt,
    skills: row.skills,
    agents: row.agents,
    version: row.version,
    createdBy: row.created_by,
  };
}

export class PgChatPresetRepository implements ChatPresetRepository {
  constructor(private readonly db: DatabasePort) {}

  async findPreset(orgId: OrgId, presetId: string): Promise<PresetRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<PresetDbRow>(
        `SELECT id, project_id, opening_prompt, skills, agents, version, created_by
           FROM chat_presets WHERE id = $1 AND org_id = $2`,
        [presetId, orgId],
      );
      const row = r.rows[0];
      return row ? toPresetRecord(row) : null;
    });
  }

  /**
   * 新建走 INSERT；编辑走 `UPDATE ... WHERE version = $expected` 同一条语句里比对
   * 并自增——与 F109 `renameThread` 同一个理由：不留「先查再改」的并发窗口。
   */
  async upsertPreset(
    orgId: OrgId,
    projectId: string,
    input: UpsertPresetRepoInput,
  ): Promise<UpsertPresetOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      if (input.isNew) {
        await s.query(
          `INSERT INTO chat_presets
             (id, org_id, project_id, opening_prompt, skills, agents, version, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7)`,
          [input.presetId, orgId, projectId, input.openingPrompt, input.skills, input.agents, input.createdBy],
        );
        return { kind: "ok", presetId: input.presetId, version: 1 };
      }

      const expected = input.expectedVersion ?? 0;
      const r = await s.query<{ version: number }>(
        `UPDATE chat_presets
           SET opening_prompt = $1, skills = $2, agents = $3,
               version = version + 1, updated_at = now()
         WHERE id = $4 AND org_id = $5 AND version = $6
         RETURNING version`,
        [input.openingPrompt, input.skills, input.agents, input.presetId, orgId, expected],
      );
      const row = r.rows[0];
      if (!row) return { kind: "version-changed" };
      return { kind: "ok", presetId: input.presetId, version: row.version };
    });
  }

  /**
   * 占位实现：只答「存不存在于组织目录」，不答「对下发对象是否可见」——
   * 见文件头。返回第一个不在目录里的 id；agents 先查，与
   * `checkPresetDispatchScope` 的「报告第一个越范围的」纪律一致（这里报告的是
   * 「第一个不存在的」，两者是同一种「找第一个」的收敛）。
   */
  async findOutOfScopeResource(
    orgId: OrgId,
    agentIds: readonly string[],
    skillIds: readonly string[],
  ): Promise<{ readonly kind: "agent" | "skill"; readonly id: string } | null> {
    return this.db.withTenant(orgId, async (s) => {
      if (agentIds.length > 0) {
        const r = await s.query<{ agent_id: string }>(
          `SELECT a.id AS agent_id
             FROM unnest($1::text[]) AS a(id)
             LEFT JOIN org_agents oa ON oa.org_id = $2 AND oa.agent_id = a.id
            WHERE oa.agent_id IS NULL
            LIMIT 1`,
          [agentIds, orgId],
        );
        const row = r.rows[0];
        if (row) return { kind: "agent", id: row.agent_id };
      }
      if (skillIds.length > 0) {
        const r = await s.query<{ skill_id: string }>(
          `SELECT sk.id AS skill_id
             FROM unnest($1::text[]) AS sk(id)
             LEFT JOIN org_skills os ON os.org_id = $2 AND os.skill_id = sk.id
            WHERE os.skill_id IS NULL
            LIMIT 1`,
          [skillIds, orgId],
        );
        const row = r.rows[0];
        if (row) return { kind: "skill", id: row.skill_id };
      }
      return null;
    });
  }

  async countDispatchTargets(
    orgId: OrgId,
    projectId: string,
    targets: { readonly plenary: boolean; readonly groupIds: readonly string[]; readonly roles: readonly string[] },
  ): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      if (targets.plenary) {
        const r = await s.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_memberships
            WHERE project_id = $1 AND org_id = $2`,
          [projectId, orgId],
        );
        return Number(r.rows[0]?.count ?? "0");
      }
      const r = await s.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM project_memberships
          WHERE project_id = $1 AND org_id = $2
            AND (group_id = ANY($3::text[]) OR project_role = ANY($4::text[]))`,
        [projectId, orgId, targets.groupIds, targets.roles],
      );
      return Number(r.rows[0]?.count ?? "0");
    });
  }

  async findExistingDispatch(
    orgId: OrgId,
    presetId: string,
    targetsFingerprint: string,
    version: number,
  ): Promise<PresetDispatchRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; target_count: number }>(
        `SELECT id, target_count FROM chat_preset_dispatches
          WHERE preset_id = $1 AND org_id = $2 AND targets_fingerprint = $3 AND preset_version = $4`,
        [presetId, orgId, targetsFingerprint, version],
      );
      const row = r.rows[0];
      return row ? { dispatchId: row.id, targetCount: row.target_count } : null;
    });
  }

  async recordDispatch(
    orgId: OrgId,
    presetId: string,
    targetsFingerprint: string,
    version: number,
    targetCount: number,
    targets: { readonly plenary: boolean; readonly groupIds: readonly string[]; readonly roles: readonly string[] },
  ): Promise<PresetDispatchRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const dispatchId = `disp-${orgId}-${presetId}-${targetsFingerprintHash(targetsFingerprint)}-${version}`;
      // ON CONFLICT DO NOTHING + 回读：并发的两次「同一次下发」只有一个真正 INSERT，
      // 另一个读到已有的那一行——与 `findExistingDispatch` 的读侧幂等合起来才完整
      // （同 F109 `chat_transcript_sessions_one_live` 的两侧纪律）。
      await s.query(
        `INSERT INTO chat_preset_dispatches
           (id, org_id, preset_id, targets_fingerprint, plenary, group_ids, roles, preset_version, target_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (preset_id, targets_fingerprint, preset_version) DO NOTHING`,
        [
          dispatchId, orgId, presetId, targetsFingerprint,
          targets.plenary, targets.groupIds, targets.roles, version, targetCount,
        ],
      );
      const r = await s.query<{ id: string; target_count: number }>(
        `SELECT id, target_count FROM chat_preset_dispatches
          WHERE preset_id = $1 AND org_id = $2 AND targets_fingerprint = $3 AND preset_version = $4`,
        [presetId, orgId, targetsFingerprint, version],
      );
      const row = r.rows[0]!;
      return { dispatchId: row.id, targetCount: row.target_count };
    });
  }

  /**
   * 该 actor 是否命中**任一次**下发的目标范围。⚠ 这里没有把 plenary/group_ids/roles
   * 列写进 0170006 的表结构里再在这里 JOIN——已在迁移里加了，见该文件「结构化存法」。
   */
  async isActorDispatchTarget(
    orgId: OrgId,
    presetId: string,
    projectId: string,
    actorId: string,
  ): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const membership = await s.query<{ project_role: string; group_id: string | null }>(
        `SELECT project_role, group_id FROM project_memberships
          WHERE user_id = $1 AND project_id = $2 AND org_id = $3`,
        [actorId, projectId, orgId],
      );
      const m = membership.rows[0];
      if (!m) return false;
      const r = await s.query<{ id: string }>(
        `SELECT id FROM chat_preset_dispatches
          WHERE preset_id = $1 AND org_id = $2
            AND (plenary OR $3::text = ANY(group_ids) OR $4::text = ANY(roles))
          LIMIT 1`,
        [presetId, orgId, m.group_id, m.project_role],
      );
      return r.rows.length > 0;
    });
  }

  async findInstanceForActor(
    orgId: OrgId,
    presetId: string,
    actorId: string,
  ): Promise<PresetInstanceRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; thread_id: string }>(
        `SELECT id, thread_id FROM chat_preset_instances
          WHERE preset_id = $1 AND org_id = $2 AND started_by = $3`,
        [presetId, orgId, actorId],
      );
      const row = r.rows[0];
      return row ? { instanceId: row.id, threadId: row.thread_id } : null;
    });
  }

  /**
   * 建线程 + 登记实例，**同一个事务**（`withTenant` 的一次调用）。
   * `ON CONFLICT DO NOTHING` + 回读：两次并发的「开始」只有一个真正建出线程，
   * 另一个拿到已有的那个 `threadId`/`instanceId`（I-38 的写侧幂等）。
   */
  async createPresetInstance(
    orgId: OrgId,
    presetId: string,
    actorId: string,
    newThread: NewThreadInput,
  ): Promise<PresetInstanceRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const instanceId = `pinst-${orgId}-${presetId}-${actorId}`;
      const existing = await s.query<{ id: string; thread_id: string }>(
        `SELECT id, thread_id FROM chat_preset_instances
          WHERE preset_id = $1 AND org_id = $2 AND started_by = $3`,
        [presetId, orgId, actorId],
      );
      const already = existing.rows[0];
      if (already) return { instanceId: already.id, threadId: already.thread_id };

      await s.query(
        `INSERT INTO chat_threads
           (id, org_id, project_id, group_id, visibility_scope, title, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newThread.threadId, orgId, newThread.projectId, newThread.groupId,
          newThread.visibilityScope, newThread.title, newThread.createdBy,
        ],
      );
      await s.query(
        `INSERT INTO chat_preset_instances (id, org_id, preset_id, thread_id, started_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (preset_id, started_by) DO NOTHING`,
        [instanceId, orgId, presetId, newThread.threadId, actorId],
      );
      const r = await s.query<{ id: string; thread_id: string }>(
        `SELECT id, thread_id FROM chat_preset_instances
          WHERE preset_id = $1 AND org_id = $2 AND started_by = $3`,
        [presetId, orgId, actorId],
      );
      const row = r.rows[0]!;
      return { instanceId: row.id, threadId: row.thread_id };
    });
  }

  async listPresetInstances(
    orgId: OrgId,
    presetId: string,
  ): Promise<ReadonlyArray<{ readonly instanceId: string; readonly startedBy: string }>> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; started_by: string }>(
        `SELECT id, started_by FROM chat_preset_instances WHERE preset_id = $1 AND org_id = $2`,
        [presetId, orgId],
      );
      return r.rows.map((row) => ({ instanceId: row.id, startedBy: row.started_by }));
    });
  }
}

/** 短小、确定性的指纹哈希，只用于拼一个可读的 id，不用于安全目的。 */
function targetsFingerprintHash(fingerprint: string): string {
  let h = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    h = (Math.imul(31, h) + fingerprint.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
