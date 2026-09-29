/**
 * Phase 20 EV04 —— `skill_gate_records`（按版本一行）+ `skill_gate_writeback_events`（只追加，幂等）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`（RLS 按 org_id），WHERE 仍显式带 `org_id`。
 * ⚠ 当前版本 = 最新一条 published 的 `skill_versions`（与 WS03 目录同语义）。
 * ⚠ 版本 digest 口径：`sha256:` + `skill_versions.content_digest`（契约 `WorkGateStatus.subjectVersionDigest`）。
 */
import { randomUUID } from "node:crypto";
import { WorkGateStatus } from "@repo/contracts/work-eval";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  GateStatusSnapshot,
  GateWriteOutcome,
  WorkGateStatusRepository,
} from "../../application/work-eval/work-gate-status";
import type { OrgId } from "../../domain/org-id";

const digestOf = (hex: string) => `sha256:${hex}`;

export class PgWorkGateStatusRepository implements WorkGateStatusRepository {
  constructor(private readonly db: DatabasePort) {}

  async writeBack(input: Parameters<WorkGateStatusRepository["writeBack"]>[0]): Promise<GateWriteOutcome> {
    return this.db.withTenant(input.orgId, async (session): Promise<GateWriteOutcome> => {
      const prior = await session.query<{ skill_id: string; skill_version_id: string; request_digest: string }>(
        `SELECT skill_id, skill_version_id, request_digest FROM skill_gate_writeback_events
          WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      const replay = prior.rows[0];
      if (replay) {
        if (replay.request_digest !== input.requestDigest || replay.skill_id !== input.skillId) {
          return { kind: "idempotency-conflict" };
        }
        return { kind: "replayed", versionId: replay.skill_version_id };
      }
      const entry = await session.query<{ stable_id: string }>(
        "SELECT stable_id FROM skill_catalog_entries WHERE org_id = $1 AND skill_id = $2 FOR UPDATE",
        [input.orgId, input.skillId],
      );
      const row = entry.rows[0];
      if (!row) return { kind: "not-found" };
      if (row.stable_id !== input.status.stableId) return { kind: "stable-id-mismatch" };
      const hex = input.status.subjectVersionDigest.slice("sha256:".length);
      const version = await session.query<{ id: string }>(
        `SELECT id FROM skill_versions
          WHERE org_id = $1 AND skill_id = $2 AND content_digest = $3 AND published
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [input.orgId, input.skillId, hex],
      );
      const versionId = version.rows[0]?.id;
      if (!versionId) return { kind: "digest-mismatch" };
      const at = new Date().toISOString();
      await session.query(
        `INSERT INTO skill_gate_records
           (org_id, skill_id, skill_version_id, subject_version_digest, status, decided_at, written_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8)
         ON CONFLICT (org_id, skill_version_id) DO UPDATE
           SET subject_version_digest = EXCLUDED.subject_version_digest, status = EXCLUDED.status,
               decided_at = EXCLUDED.decided_at, written_by = EXCLUDED.written_by, updated_at = EXCLUDED.updated_at`,
        [input.orgId, input.skillId, versionId, input.status.subjectVersionDigest, JSON.stringify(input.status),
          input.status.decidedAt, input.actorId, at],
      );
      await session.query(
        `INSERT INTO skill_gate_writeback_events
           (id, org_id, skill_id, skill_version_id, idempotency_key, request_digest, actor_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [`skill-gate-event-${randomUUID()}`, input.orgId, input.skillId, versionId, input.idempotencyKey,
          input.requestDigest, input.actorId, at],
      );
      return { kind: "written", versionId };
    });
  }

  async read(orgId: OrgId, skillId: string, versionId?: string): Promise<GateStatusSnapshot | null> {
    return this.db.withTenant(orgId, async (session) => {
      const entry = await session.query<{ channel: GateStatusSnapshot["channel"] }>(
        "SELECT channel FROM skill_catalog_entries WHERE org_id = $1 AND skill_id = $2",
        [orgId, skillId],
      );
      const channel = entry.rows[0]?.channel;
      if (!channel) return null;
      const versions = await session.query<{
        id: string; semantic_label: string; content_digest: string; manifest: { work?: { evalSuiteId?: string | null } };
      }>(
        `SELECT id, semantic_label, content_digest, manifest FROM skill_versions
          WHERE org_id = $1 AND skill_id = $2 AND published
          ORDER BY created_at DESC, id DESC`,
        [orgId, skillId],
      );
      const current = versions.rows[0];
      if (!current) return null;
      const selected = versionId === undefined ? current : versions.rows.find((v) => v.id === versionId);
      if (!selected) return null;
      const rec = await session.query<{ status: unknown }>(
        "SELECT status FROM skill_gate_records WHERE org_id = $1 AND skill_id = $2 AND skill_version_id = $3",
        [orgId, skillId, selected.id],
      );
      const parsed = rec.rows[0] ? WorkGateStatus.safeParse(rec.rows[0].status) : null;
      return {
        channel,
        evalSuiteId: selected.manifest.work?.evalSuiteId ?? null,
        currentDigest: digestOf(current.content_digest),
        version: { id: selected.id, semanticLabel: selected.semantic_label, digest: digestOf(selected.content_digest) },
        record: parsed?.success ? parsed.data : null,
      };
    });
  }
}
