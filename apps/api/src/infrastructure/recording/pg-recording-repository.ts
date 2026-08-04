/**
 * issue #465 — PostgreSQL behind F69's capture ports, plus the two the routes added.
 *
 * ## One file, one transaction, six tables
 *
 * Every store below is built over the SAME `TenantSession`, so `startRecording`'s session
 * row and its N track rows either all exist or none do. That is not tidiness: the consent
 * gate refuses AFTER a live-session check and BEFORE any write, and "writes nothing" is
 * asserted by counting rows in `tests/rec/recording-http-session-lifecycle.test.ts`. With a
 * transaction per method that assertion would depend on compensating deletes running, which
 * is to say on the process not dying.
 *
 * ## Why this file is on `lint-permission-paths.mjs`'s allowlist
 *
 * See the entry there for the argument; in short, this is a WRITE path plus the reads that
 * decide whether the write is allowed, and `NO_PROJECT_ROLE` is already settled one layer up
 * in `RecordingController` (via `IdentityRepository.findProjectMembership`) before this file
 * is ever reached — the same ordering `pg-agenda-segment-repository.ts` and
 * `pg-project-archive-repository.ts` document for themselves. `tests/rec/recording-repo-scope-guard.test.ts`
 * is the mechanical half: it fails if this file names a tenant table outside the six declared,
 * if it ever calls `withoutTenant`, or if anything under `src/interface/` imports it directly.
 *
 * ## Live sessions have a computed duration
 *
 * `durationMs` for a session that has not ended is elapsed wall clock, computed in SQL. It
 * is what `ingestSegment` range-checks timecode anchors against (I-2) and what
 * `endRecording` reports, and having ONE expression for it means a segment cannot be
 * accepted against one notion of "how long has this been running" and reported against
 * another.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { RetentionPolicyRepository } from "../../application/files/retention-policy-ports";
import type { OrgId } from "../../domain/org-id";
import type {
  IdGenerator,
  RecordingSessionState,
  RetentionResolver,
  SegmentStore,
  TrackState,
  TrackStore,
  TranscribedSegment,
} from "../../application/recording/ports";
import type {
  ConsentMatrixReader,
  IdempotencyLookup,
  IdempotencyStore,
  RecordingOperationName,
  RecordingSessionLifecycleState,
  RecordingStores,
  RecordingUnitOfWork,
  SegmentLifecycleStore,
  SessionLifecycleStore,
} from "../../application/recording/session-lifecycle-ports";
import type { SourceType } from "../../domain/recording/transcription-core";
import type { TranscriptLineSource } from "../../domain/recording/transcript-file";
import type { GapRange, MicState } from "../../domain/recording/mic-state";

/** Deterministic-shaped ids, minted here so use cases stay free of `randomUUID`. */
export class UuidRecordingIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

interface SessionRow {
  id: string;
  project_id: string;
  source_type: SourceType;
  source_ref_id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: string | number | null;
  materialize_job_id: string | null;
  retention_days: number;
  retention_from: "project" | "org";
  expires_at: string;
  live_duration_ms: string | number;
}

interface TrackRow {
  id: string;
  session_id: string;
  participant_id: string | null;
  mic_state: MicState;
  gap_ranges: GapRange[];
  open_gap_from_ms: string | number | null;
}

interface SegmentRow {
  id: string;
  session_id: string;
  track_id: string;
  source_type: SourceType;
  anchor_start_ms: string | number | null;
  anchor_end_ms: string | number | null;
  anchor_message_id: string | null;
  speaker_channel_id: string | null;
  status: TranscribedSegment["status"];
  low_confidence: boolean;
  text: string;
  pii_findings: TranscribedSegment["piiFindings"];
}

/** `pg` returns bigint as a string to avoid silent precision loss. */
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

const SESSION_COLUMNS = `
  id, project_id, source_type, source_ref_id,
  started_at, ended_at, duration_ms, materialize_job_id,
  retention_days, retention_from, expires_at,
  COALESCE(duration_ms, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint)
    AS live_duration_ms`;

function toSessionState(row: SessionRow): RecordingSessionLifecycleState {
  return {
    sessionId: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sourceRefId: row.source_ref_id,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
    durationMs: Math.max(0, num(row.live_duration_ms) ?? 0),
    materializeJobId: row.materialize_job_id,
    retention: {
      resolvedDays: row.retention_days,
      resolvedFrom: row.retention_from,
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}

/**
 * The one piece of state shared between the retention resolver and the session store.
 *
 * `startRecording` resolves retention and then creates the session (`capture.ts`'s stated
 * order), and the session row stores what was resolved. Passing it through the F69 port
 * would mean widening `SessionStore.create`, which every existing test and fake implements;
 * carrying it here instead keeps F69 untouched — at the cost of an ordering requirement,
 * which is why `create` THROWS when it is unmet rather than filling in a number.
 */
interface RequestScope {
  readonly actorId: string;
  resolution?: { resolvedDays: number; resolvedFrom: "project" | "org"; resolvedAt: string };
}

function sessionStore(s: TenantSession, orgId: OrgId, scope: RequestScope): SessionLifecycleStore {
  const read = async (sessionId: string): Promise<RecordingSessionLifecycleState | undefined> => {
    const r = await s.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM recording_sessions WHERE id = $1 AND org_id = $2`,
      [sessionId, orgId],
    );
    const row = r.rows[0];
    return row === undefined ? undefined : toSessionState(row);
  };

  return {
    async session(sessionId: string): Promise<RecordingSessionState | undefined> {
      return read(sessionId);
    },
    lifecycleSession: read,
    async liveSessionFor(sourceRefId: string): Promise<string | undefined> {
      const r = await s.query<{ id: string }>(
        `SELECT id FROM recording_sessions
          WHERE org_id = $1 AND source_ref_id = $2 AND ended_at IS NULL`,
        [orgId, sourceRefId],
      );
      return r.rows[0]?.id;
    },
    async create(input) {
      const resolution = scope.resolution;
      if (resolution === undefined) {
        // I-33 has exactly one enforcement point and this is not it -- the use case refuses
        // `RETENTION_POLICY_MISSING` before ever calling here. Reaching this line means the
        // call order changed, and the only safe answer is to stop, not to pick a number.
        throw new Error(
          "recording session create reached without a resolved retention policy: " +
            "resolve retention before creating the session (see capture.ts's stated order)",
        );
      }
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + resolution.resolvedDays * 86_400_000);
      await s.query(
        `INSERT INTO recording_sessions
           (id, org_id, project_id, source_type, source_ref_id, started_at,
            retention_days, retention_from, retention_resolved_at, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          input.sessionId, orgId, input.projectId, input.sourceType, input.sourceRefId,
          startedAt.toISOString(), resolution.resolvedDays, resolution.resolvedFrom,
          resolution.resolvedAt, expiresAt.toISOString(), scope.actorId,
        ],
      );
    },
    async end(input) {
      await s.query(
        `UPDATE recording_sessions
            SET ended_at = $3, duration_ms = $4, materialize_job_id = $5
          WHERE id = $1 AND org_id = $2 AND ended_at IS NULL`,
        [input.sessionId, orgId, input.endedAt, input.durationMs, input.materializeJobId],
      );
    },
  };
}

function trackStore(s: TenantSession, orgId: OrgId): TrackStore {
  const toState = (row: TrackRow): TrackState => ({
    trackId: row.id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    timeline: {
      micState: row.mic_state,
      gapRanges: row.gap_ranges,
      openGapFromMs: num(row.open_gap_from_ms),
    },
  });

  return {
    async track(trackId) {
      const r = await s.query<TrackRow>(
        `SELECT id, session_id, participant_id, mic_state, gap_ranges, open_gap_from_ms
           FROM recording_tracks WHERE id = $1 AND org_id = $2`,
        [trackId, orgId],
      );
      const row = r.rows[0];
      return row === undefined ? undefined : toState(row);
    },
    async tracksOf(sessionId) {
      const r = await s.query<TrackRow>(
        `SELECT id, session_id, participant_id, mic_state, gap_ranges, open_gap_from_ms
           FROM recording_tracks WHERE session_id = $1 AND org_id = $2 ORDER BY id`,
        [sessionId, orgId],
      );
      return r.rows.map(toState);
    },
    async create(track) {
      await s.query(
        `INSERT INTO recording_tracks
           (id, org_id, session_id, participant_id, mic_state, gap_ranges, open_gap_from_ms)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          track.trackId, orgId, track.sessionId, track.participantId,
          track.timeline.micState, JSON.stringify(track.timeline.gapRanges),
          track.timeline.openGapFromMs,
        ],
      );
    },
    async updateTimeline(trackId, timeline) {
      await s.query(
        `UPDATE recording_tracks
            SET mic_state = $3, gap_ranges = $4::jsonb, open_gap_from_ms = $5
          WHERE id = $1 AND org_id = $2`,
        [trackId, orgId, timeline.micState, JSON.stringify(timeline.gapRanges), timeline.openGapFromMs],
      );
    },
  };
}

function segmentStore(s: TenantSession, orgId: OrgId, ids: IdGenerator): SegmentLifecycleStore {
  const toLine = (row: SegmentRow): TranscriptLineSource => ({
    id: row.id,
    sessionId: row.session_id,
    trackId: row.track_id,
    sourceType: row.source_type,
    anchor: {
      startMs: num(row.anchor_start_ms),
      endMs: num(row.anchor_end_ms),
      messageId: row.anchor_message_id,
    },
    speakerChannelId: row.speaker_channel_id,
    status: row.status,
    lowConfidence: row.low_confidence,
    text: row.text,
    piiFindings: row.pii_findings,
  });

  const select = `id, session_id, track_id, source_type, anchor_start_ms, anchor_end_ms,
    anchor_message_id, speaker_channel_id, status, low_confidence, text, pii_findings`;

  return {
    async append(segment: TranscribedSegment) {
      const segmentId = ids.next("rec-seg");
      // The ordinal is computed inside the SAME transaction as the insert, and
      // `recording_segments_ordinal_uniq` turns a lost race into an error rather than into
      // two segments claiming the same position in the transcript.
      await s.query(
        `INSERT INTO recording_segments
           (id, org_id, session_id, track_id, ordinal, source_type,
            anchor_start_ms, anchor_end_ms, anchor_message_id, speaker_channel_id,
            status, low_confidence, text, pii_findings)
         SELECT $1,$2,$3,$4,
                COALESCE(MAX(ordinal), 0) + 1,
                $5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb
           FROM recording_segments WHERE org_id = $2 AND session_id = $3`,
        [
          segmentId, orgId, segment.sessionId, segment.trackId, segment.sourceType,
          segment.anchor.startMs, segment.anchor.endMs, segment.anchor.messageId,
          segment.speakerChannelId, segment.status, segment.lowConfidence, segment.text,
          JSON.stringify(segment.piiFindings),
        ],
      );
      return { segmentId };
    },
    async ofTrack(trackId) {
      const r = await s.query<SegmentRow>(
        `SELECT ${select} FROM recording_segments
          WHERE track_id = $1 AND org_id = $2 ORDER BY ordinal`,
        [trackId, orgId],
      );
      // `TranscribedSegment` is unforgeable outside `transcription-core.ts` by design (F69),
      // so a row read back cannot BE one. This port is used only by F69's cross-track
      // isolation assertion, which reads the fields; the cast is confined to this line and
      // never widens `append`, which is where the invariant actually lives.
      return r.rows.map((row) => toLine(row) as unknown as TranscribedSegment);
    },
    async ofSession(sessionId) {
      const r = await s.query<SegmentRow>(
        `SELECT ${select} FROM recording_segments
          WHERE session_id = $1 AND org_id = $2 ORDER BY ordinal`,
        [sessionId, orgId],
      );
      return r.rows.map(toLine);
    },
  } satisfies SegmentStore & SegmentLifecycleStore;
}

function consentReader(s: TenantSession, orgId: OrgId): ConsentMatrixReader {
  return {
    async blocksStart(sourceRefId, participantIds) {
      // An unidentified room is not a consented room. Nobody to have asked ⇒ refuse.
      if (participantIds.length === 0) return true;
      const r = await s.query<{ participant_id: string; granted: string }>(
        `SELECT participant_id, count(*) FILTER (WHERE state = 'granted')::text AS granted
           FROM recording_consent_cells
          WHERE org_id = $1 AND source_ref_id = $2 AND participant_id = ANY($3::text[])
          GROUP BY participant_id`,
        [orgId, sourceRefId, [...participantIds]],
      );
      const granted = new Map(r.rows.map((row) => [row.participant_id, Number(row.granted)]));
      // Three items, all `granted`, for EVERY participant. A missing row counts as 0, which
      // is how "never asked" stays distinguishable from "said yes".
      return participantIds.some((p) => (granted.get(p) ?? 0) < 3);
    },
  };
}

function idempotencyStore(s: TenantSession, orgId: OrgId): IdempotencyStore {
  return {
    async lookup<T>(
      operation: RecordingOperationName,
      key: string,
      payloadDigest: string,
    ): Promise<IdempotencyLookup<T>> {
      const r = await s.query<{ payload_digest: string; result_json: T }>(
        `SELECT payload_digest, result_json FROM recording_operation_idempotency
          WHERE org_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [orgId, operation, key],
      );
      const row = r.rows[0];
      if (row === undefined) return { kind: "missing" };
      if (row.payload_digest !== payloadDigest) return { kind: "conflict" };
      return { kind: "replay", result: row.result_json };
    },
    async remember(input) {
      await s.query(
        `INSERT INTO recording_operation_idempotency
           (org_id, operation, idempotency_key, payload_digest, result_json)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [orgId, input.operation, input.key, input.payloadDigest, JSON.stringify(input.result)],
      );
    },
  };
}

/**
 * F69's `RetentionResolver`, backed by F46's `retention_policies` — NOT by a table of this
 * bundle's own.
 *
 * `application/recording/retention-ports.ts` states the reason at length: a second store for
 * "how many days" is a second source for the one fact this whole feature is about. F46's
 * repository is reused whole rather than re-queried here, so `retention_policies` keeps
 * exactly one SQL reader.
 *
 * ⚠ `resolvedFrom: "org"` is not reachable today, and that is a REPORTED GAP rather than a
 *   silent one: the schema has no organization-level day count (`retention_policies` is
 *   keyed by project, and `organizations` carries only `retention_until`, a timestamp for
 *   F22's lifecycle, not a duration). So a project with no override resolves to `undefined`
 *   ⇒ `RETENTION_POLICY_MISSING` ⇒ refuse to start. That is E5's fail-closed answer; what is
 *   missing is the org-level default it is supposed to fall back to first, which needs the
 *   00-core / 17-gov retention kernel to exist. Inventing a constant here is the one thing
 *   I-32 names outright.
 */
function retentionResolver(
  policies: RetentionPolicyRepository,
  orgId: OrgId,
  scope: RequestScope,
): RetentionResolver {
  return {
    async resolve(input) {
      const override = await policies.getOverride(orgId, input.projectId);
      const days = override?.materialDays;
      if (days === undefined) return undefined;
      const resolution = {
        resolvedDays: days,
        resolvedFrom: "project" as const,
        resolvedAt: new Date().toISOString(),
      };
      scope.resolution = resolution;
      return resolution;
    },
  };
}

export class PgRecordingUnitOfWork implements RecordingUnitOfWork {
  constructor(
    private readonly db: DatabasePort,
    private readonly policies: RetentionPolicyRepository,
    private readonly ids: IdGenerator,
  ) {}

  withOrg<T>(
    orgId: OrgId,
    actor: { readonly userId: string },
    fn: (stores: RecordingStores) => Promise<T>,
  ): Promise<T> {
    const scope: RequestScope = { actorId: actor.userId };
    return this.db.withTenant(orgId, (s) =>
      fn({
        sessions: sessionStore(s, orgId, scope),
        tracks: trackStore(s, orgId),
        segments: segmentStore(s, orgId, this.ids),
        consent: consentReader(s, orgId),
        idempotency: idempotencyStore(s, orgId),
        retention: retentionResolver(this.policies, orgId, scope),
      }),
    );
  }
}
