import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { PersonalTranscriptionCursorInvalid } from "../../application/recording/personal-transcription-ports";
import type {
  PersonalTranscriptionDetail,
  PersonalTranscriptionRepository,
  PersonalTranscriptionSummary,
} from "../../application/recording/personal-transcription-ports";
import type { OrgId } from "../../domain/org-id";

interface SummaryRow {
  id: string;
  name: string;
  tags: string[];
  status: PersonalTranscriptionSummary["status"];
  duration_ms: string | number;
  created_at: string;
  updated_at: string;
  content: string;
}

const PAGE_SIZE = 24;
const iso = (value: string): string => new Date(value).toISOString();
const number = (value: string | number): number => Number(value);

const SUMMARY_COLUMNS = `p.id, p.name, p.tags, p.content,
  CASE
    WHEN bool_or(rs.ended_at IS NULL) FILTER (WHERE rs.id IS NOT NULL) THEN 'recording'
    WHEN count(rs.id) > 0 THEN 'idle'
    ELSE p.status
  END AS status,
  COALESCE(sum(COALESCE(rs.duration_ms,
    floor(extract(epoch FROM (now() - rs.started_at)) * 1000)::bigint)), 0)::text AS duration_ms,
  p.created_at,
  GREATEST(p.updated_at, COALESCE(max(COALESCE(rs.ended_at, rs.started_at)), p.updated_at)) AS updated_at`;

function summary(row: SummaryRow): PersonalTranscriptionSummary {
  return C.PersonalTranscriptionSummary.parse({
    sessionId: row.id,
    name: row.name,
    tags: row.tags,
    status: row.status,
    durationMs: number(row.duration_ms),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function encodeCursor(row: SummaryRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: iso(row.updated_at), id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { updatedAt: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object" && decoded !== null &&
      typeof (decoded as { updatedAt?: unknown }).updatedAt === "string" &&
      Number.isFinite(Date.parse((decoded as { updatedAt: string }).updatedAt)) &&
      typeof (decoded as { id?: unknown }).id === "string" &&
      (decoded as { id: string }).id.length > 0
    ) {
      return decoded as { updatedAt: string; id: string };
    }
  } catch {
    // Fall through to the closed validation failure below.
  }
  throw new PersonalTranscriptionCursorInvalid();
}

async function readSummary(
  session: TenantSession,
  orgId: OrgId,
  ownerUserId: string,
  transcriptionId: string,
): Promise<SummaryRow | undefined> {
  const result = await session.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM personal_transcriptions p
       LEFT JOIN recording_sessions rs
         ON rs.org_id = p.org_id AND rs.source_type = 'personal' AND rs.source_ref_id = p.id
      WHERE p.org_id = $1 AND p.owner_user_id = $2 AND p.id = $3
      GROUP BY p.id, p.name, p.tags, p.content, p.status, p.created_at, p.updated_at`,
    [orgId, ownerUserId, transcriptionId],
  );
  return result.rows[0];
}

export class PgPersonalTranscriptionRepository implements PersonalTranscriptionRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: {
    transcriptionId: string;
    orgId: OrgId;
    ownerUserId: string;
    name: string;
    tags: readonly string[];
  }): Promise<PersonalTranscriptionSummary> {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query(
        `INSERT INTO personal_transcriptions (id, org_id, owner_user_id, name, tags)
         VALUES ($1,$2,$3,$4,$5::text[])`,
        [input.transcriptionId, input.orgId, input.ownerUserId, input.name, [...input.tags]],
      );
      const row = await readSummary(session, input.orgId, input.ownerUserId, input.transcriptionId);
      if (row === undefined) throw new Error("personal transcription insert could not be read back");
      return summary(row);
    });
  }

  async listOwned(input: {
    orgId: OrgId;
    ownerUserId: string;
    query?: string;
    tag?: string;
    sort: "recent" | "oldest";
    cursor?: string;
  }): Promise<{ items: readonly PersonalTranscriptionSummary[]; nextCursor: string | null }> {
    return this.db.withTenant(input.orgId, async (session) => {
      const cursor = decodeCursor(input.cursor);
      const direction = input.sort === "oldest" ? "ASC" : "DESC";
      const comparison = input.sort === "oldest" ? ">" : "<";
      const result = await session.query<SummaryRow>(
        `SELECT *
           FROM (
             SELECT ${SUMMARY_COLUMNS}
               FROM personal_transcriptions p
               LEFT JOIN recording_sessions rs
                 ON rs.org_id = p.org_id AND rs.source_type = 'personal' AND rs.source_ref_id = p.id
              WHERE p.org_id = $1 AND p.owner_user_id = $2
                AND (
                  $3::text IS NULL OR p.name ILIKE '%' || $3 || '%' OR p.content ILIKE '%' || $3 || '%'
                )
                AND ($4::text IS NULL OR $4 = ANY(p.tags))
              GROUP BY p.id, p.name, p.tags, p.content, p.status, p.created_at, p.updated_at
           ) AS owned_summaries
          WHERE ($5::timestamptz IS NULL OR (updated_at, id) ${comparison} ($5::timestamptz, $6::text))
          ORDER BY updated_at ${direction}, id ${direction}
          LIMIT $7`,
        [
          input.orgId,
          input.ownerUserId,
          input.query?.trim() || null,
          input.tag ?? null,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          PAGE_SIZE + 1,
        ],
      );
      const page = result.rows.slice(0, PAGE_SIZE);
      return {
        items: page.map(summary),
        nextCursor: result.rows.length > PAGE_SIZE && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
      };
    });
  }

  async readOwned(input: {
    orgId: OrgId;
    ownerUserId: string;
    transcriptionId: string;
  }): Promise<PersonalTranscriptionDetail | undefined> {
    return this.db.withTenant(input.orgId, async (session) => {
      const metadata = await readSummary(session, input.orgId, input.ownerUserId, input.transcriptionId);
      if (metadata === undefined) return undefined;

      return C.PersonalTranscriptionDetail.parse({
        ...summary(metadata),
        content: metadata.content,
      });
    });
  }

  async hasActiveCapture(input: { orgId: OrgId; ownerUserId: string; transcriptionId: string }): Promise<boolean> {
    return this.db.withTenant(input.orgId, async (session) => {
      const result = await session.query(
        `SELECT 1 FROM recording_sessions rs
          JOIN personal_transcriptions p ON p.id=rs.source_ref_id AND p.org_id=rs.org_id
         WHERE p.id=$1 AND p.org_id=$2 AND p.owner_user_id=$3
           AND rs.source_type='personal' AND rs.created_by=p.owner_user_id AND rs.ended_at IS NULL
         LIMIT 1`,
        [input.transcriptionId, input.orgId, input.ownerUserId],
      );
      return result.rows.length > 0;
    });
  }

  async replaceContent(input: { orgId: OrgId; ownerUserId: string; transcriptionId: string;
    content: string }): Promise<PersonalTranscriptionDetail | undefined> {
    return this.db.withTenant(input.orgId, async (session) => {
      const updated = await session.query<{ id: string }>(
        `UPDATE personal_transcriptions p SET content=$1,updated_at=now()
          WHERE p.id=$2 AND p.org_id=$3 AND p.owner_user_id=$4
            AND NOT EXISTS (SELECT 1 FROM recording_sessions rs
              WHERE rs.org_id=p.org_id AND rs.source_type='personal' AND rs.source_ref_id=p.id
                AND rs.created_by=p.owner_user_id AND rs.ended_at IS NULL)
          RETURNING p.id`,
        [input.content, input.transcriptionId, input.orgId, input.ownerUserId],
      );
      if (!updated.rows[0]) return undefined;
      const row = await readSummary(session, input.orgId, input.ownerUserId, input.transcriptionId);
      return row ? C.PersonalTranscriptionDetail.parse({ ...summary(row), content: row.content }) : undefined;
    });
  }

  async startCapture(input: { orgId: OrgId; ownerUserId: string; transcriptionId: string; captureId: string; trackId: string }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      const owner = await s.query(`SELECT 1 FROM personal_transcriptions WHERE id=$1 AND org_id=$2 AND owner_user_id=$3 FOR UPDATE`,
        [input.transcriptionId, input.orgId, input.ownerUserId]);
      if (owner.rows.length === 0) throw new Error("personal transcription not owned");
      await s.query(`INSERT INTO recording_sessions
        (id,org_id,project_id,source_type,source_ref_id,started_at,retention_days,retention_from,retention_resolved_at,expires_at,created_by)
        VALUES ($1,$2,NULL,'personal',$3,now(),365,'org',now(),now()+interval '365 days',$4)`,
        [input.captureId, input.orgId, input.transcriptionId, input.ownerUserId]);
      await s.query(`INSERT INTO recording_tracks (id,org_id,session_id,participant_id,mic_state)
        VALUES ($1,$2,$3,$4,'granted')`, [input.trackId, input.orgId, input.captureId, input.ownerUserId]);
      await s.query(`UPDATE personal_transcriptions SET status='recording',updated_at=now() WHERE id=$1`, [input.transcriptionId]);
    });
  }

  async appendFinal(input: { orgId: OrgId; ownerUserId: string; transcriptionId: string; captureId: string;
    segmentId: string; ordinal: number; text: string; startMs: number; endMs: number }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      const appended = await s.query(
        `UPDATE personal_transcriptions p
            SET content=concat_ws(' ',NULLIF(p.content,''),$1::text),updated_at=now()
          WHERE p.id=$2 AND p.org_id=$3 AND p.owner_user_id=$4
            AND EXISTS (SELECT 1 FROM recording_sessions rs
              WHERE rs.id=$5 AND rs.org_id=p.org_id AND rs.source_type='personal'
                AND rs.source_ref_id=p.id AND rs.created_by=p.owner_user_id AND rs.ended_at IS NULL)
          RETURNING p.id`,
        [input.text, input.transcriptionId, input.orgId, input.ownerUserId, input.captureId],
      );
      if (appended.rows.length !== 1) throw new Error("personal capture is not active or not owned");
    });
  }

  async finishCapture(input: { orgId: OrgId; ownerUserId: string; transcriptionId: string; captureId: string;
    durationMs: number; failed?: boolean }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      const ended = await s.query(`UPDATE recording_sessions SET ended_at=now(),duration_ms=$1,materialize_job_id=$2
        WHERE id=$3 AND org_id=$4 AND source_ref_id=$5 AND created_by=$6 AND ended_at IS NULL RETURNING id`,
        [input.durationMs,`personal:${input.captureId}`,input.captureId,input.orgId,input.transcriptionId,input.ownerUserId]);
      if (ended.rows.length !== 1) throw new Error("personal capture is not active or not owned");
      await s.query(`UPDATE personal_transcriptions SET status=$1,updated_at=now() WHERE id=$2 AND owner_user_id=$3`,
        [input.failed ? "failed" : "idle",input.transcriptionId,input.ownerUserId]);
    });
  }
}
