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
}

interface CaptureRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: string | number;
}

interface SegmentRow {
  id: string;
  session_id: string;
  ordinal: number;
  text: string;
  anchor_start_ms: string | number;
  anchor_end_ms: string | number;
  created_at: string;
}

const PAGE_SIZE = 24;
const iso = (value: string): string => new Date(value).toISOString();
const number = (value: string | number): number => Number(value);

const SUMMARY_COLUMNS = `p.id, p.name, p.tags,
  CASE
    WHEN bool_or(rs.ended_at IS NULL) FILTER (WHERE rs.id IS NOT NULL) THEN 'recording'
    WHEN count(rs.id) > 0 THEN 'completed'
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
      GROUP BY p.id, p.name, p.tags, p.status, p.created_at, p.updated_at`,
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
                  $3::text IS NULL OR p.name ILIKE '%' || $3 || '%' OR EXISTS (
                    SELECT 1
                      FROM recording_sessions search_session
                      JOIN recording_segments search_segment
                        ON search_segment.org_id = search_session.org_id
                       AND search_segment.session_id = search_session.id
                     WHERE search_session.org_id = p.org_id
                       AND search_session.source_type = 'personal'
                       AND search_session.source_ref_id = p.id
                       AND search_session.created_by = p.owner_user_id
                       AND search_segment.status = 'final'
                       AND search_segment.text ILIKE '%' || $3 || '%'
                  )
                )
                AND ($4::text IS NULL OR $4 = ANY(p.tags))
              GROUP BY p.id, p.name, p.tags, p.status, p.created_at, p.updated_at
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

      const captures = await session.query<CaptureRow>(
        `SELECT rs.id, rs.started_at, rs.ended_at,
                COALESCE(rs.duration_ms,
                  floor(extract(epoch FROM (now() - rs.started_at)) * 1000)::bigint)::text AS duration_ms
           FROM recording_sessions rs
           JOIN personal_transcriptions p
             ON p.id = rs.source_ref_id AND p.org_id = rs.org_id
          WHERE p.id = $1 AND p.org_id = $2 AND p.owner_user_id = $3
            AND rs.source_type = 'personal' AND rs.created_by = p.owner_user_id
          ORDER BY rs.started_at, rs.id`,
        [input.transcriptionId, input.orgId, input.ownerUserId],
      );

      const segments = await session.query<SegmentRow>(
        `SELECT seg.id, seg.session_id, seg.ordinal, seg.text,
                seg.anchor_start_ms, seg.anchor_end_ms, seg.created_at
           FROM recording_segments seg
           JOIN recording_sessions rs
             ON rs.id = seg.session_id AND rs.org_id = seg.org_id
           JOIN personal_transcriptions p
             ON p.id = rs.source_ref_id AND p.org_id = rs.org_id
          WHERE p.id = $1 AND p.org_id = $2 AND p.owner_user_id = $3
            AND rs.source_type = 'personal' AND rs.created_by = p.owner_user_id
            AND seg.status = 'final'
          ORDER BY rs.started_at, rs.id, seg.ordinal`,
        [input.transcriptionId, input.orgId, input.ownerUserId],
      );
      const segmentsByCapture = new Map<string, SegmentRow[]>();
      for (const row of segments.rows) {
        const rows = segmentsByCapture.get(row.session_id) ?? [];
        rows.push(row);
        segmentsByCapture.set(row.session_id, rows);
      }

      return C.PersonalTranscriptionDetail.parse({
        ...summary(metadata),
        captures: captures.rows.map((capture) => ({
          captureId: capture.id,
          status: capture.ended_at === null ? "recording" : "completed",
          startedAt: iso(capture.started_at),
          endedAt: capture.ended_at === null ? null : iso(capture.ended_at),
          durationMs: number(capture.duration_ms),
          segments: (segmentsByCapture.get(capture.id) ?? []).map((segment) => ({
            segmentId: segment.id,
            captureId: segment.session_id,
            ordinal: segment.ordinal,
            text: segment.text,
            startMs: number(segment.anchor_start_ms),
            endMs: number(segment.anchor_end_ms),
            createdAt: iso(segment.created_at),
          })),
        })),
      });
    });
  }
}
