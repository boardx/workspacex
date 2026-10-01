/**
 * `ProjectEvidenceSourcePort` 的 PostgreSQL 实现（项目中枢 B3-T1，#4495）——采集器的只读来源。
 *
 * 四类来源各自的表与列名**只在这里**出现：
 *   · 问卷：`project_resource_links (kind='survey')` → `survey_workspaces.document->'model'`（`SurveyRuntime`：
 *     `title / questions / publication.questions / responses`），答卷与题目都住在 jsonb 里，整份取出在应用层展开。
 *   · 个人转写：`project_resource_links (kind='personal_transcription')` → `personal_transcriptions`
 *     → `recording_sessions (source_type='personal', source_ref_id=转写 id)` → `recording_segments (status='final')`。
 *   · 访谈：`INTERVIEW_IN_PROJECT`（#4615：链接行优先，否则 `interview_sessions.project_id`；与资源视图同一个常量）
 *     → 同上的录音链（`source_type='interview'`）+ `interview_quotes`
 *     （纪要引述，`subject_id` → `interview_subjects.display_name` 作说话人）。
 *   · 白板（#4615）：`project_resource_links (kind='whiteboard')` → `whiteboards` + `whiteboard_documents.snapshot`
 *     （Yjs 快照，经白板存储用的同一个校验器 `objects()` 在一次性 worker 里解码——不在主线程里碰二进制更新），
 *     只取活着的 `sticky` / `text` 对象。
 *   · 深研：`project_resource_links (kind='guided_research')` → `guided_research_sessions` +
 *     `guided_research_runtime.state->'sources'`（`GuidedResearchSource[]`，只取 `decision='accepted'`）。
 *
 * 全部 `withTenant` + 每条谓词带 `org_id`；内容回 `guard({kind:"project"})`，由采集用例拿判定解开。
 * `chatThreadProject` 例外：只回容器归属（`chat_threads.project_id`）与线程标题，不回任何消息正文——
 * 消息正文由 `pg-kg-extraction.ts`（豁免路径）读出并已经在抽取批次里；这里跟 `pg-project-list-repository.ts`
 * 画在同一条 D-18 线上（容器身份不是内容读取）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  InterviewSourceDoc,
  ProjectEvidenceSourcePort,
  ResearchSourceDoc,
  SurveySourceDoc,
  TranscriptSegmentSource,
  TranscriptionSourceDoc,
  WhiteboardSourceDoc,
} from "../../application/project/collect-evidence/ports";
import type { WhiteboardUpdateValidator } from "../../application/whiteboard/collaboration-ports";
import { WorkerWhiteboardUpdateValidator } from "../whiteboard/update-validator";
import { INTERVIEW_IN_PROJECT, INTERVIEW_LINK_JOIN } from "./pg-project-resource-repository";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

interface SurveyModelJson {
  title?: unknown;
  questions?: unknown;
  publication?: { questions?: unknown } | null;
  responses?: unknown;
}

interface SegmentSqlRow {
  owner_id: string;
  segment_id: string;
  ordinal: number;
  start_ms: string | number | null;
  end_ms: string | number | null;
  speaker: string | null;
  text: string;
}

const toMs = (v: string | number | null): number | null => (v === null ? null : Number(v));

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** `SurveyRuntime` 的 jsonb 投影 → 端口形状。字段拿不准的一律按空处理，不让一份旧文档拖垮整批采集。 */
export function projectSurveyModel(surveyId: string, model: SurveyModelJson | null): SurveySourceDoc {
  const questionsRaw = Array.isArray(model?.publication?.questions)
    ? (model!.publication!.questions as unknown[])
    : Array.isArray(model?.questions) ? (model!.questions as unknown[]) : [];
  const questions = questionsRaw.flatMap((q) => {
    const x = q as { id?: unknown; title?: unknown; order?: unknown };
    if (typeof x.id !== "string" || x.id === "") return [];
    return [{ id: x.id, title: asString(x.title), order: typeof x.order === "number" ? x.order : 0 }];
  });
  const responsesRaw = Array.isArray(model?.responses) ? (model!.responses as unknown[]) : [];
  const responses = responsesRaw.flatMap((r) => {
    const x = r as { id?: unknown; analysis?: unknown; answers?: unknown };
    if (typeof x.id !== "string" || x.id === "") return [];
    const answers = (Array.isArray(x.answers) ? (x.answers as unknown[]) : []).flatMap((a) => {
      const y = a as { questionId?: unknown; value?: unknown };
      return typeof y.questionId === "string" ? [{ questionId: y.questionId, value: y.value }] : [];
    });
    return [{ id: x.id, analysis: x.analysis === "excluded" ? ("excluded" as const) : ("included" as const), answers }];
  });
  return { surveyId, title: asString(model?.title), questions, responses };
}

/** 一条录音段 → 端口形状（个人转写与访谈共用）。 */
const toSegment = (r: SegmentSqlRow): TranscriptSegmentSource => ({
  segmentId: r.segment_id,
  ordinal: r.ordinal,
  startMs: toMs(r.start_ms),
  endMs: toMs(r.end_ms),
  speakerLabel: r.speaker,
  text: r.text,
});

/** 某个 (source_type, owner id 集合) 的最终录音段：owner = 转写 id 或访谈 id。 */
const SEGMENTS_SQL = `
  SELECT rs.source_ref_id AS owner_id, seg.id AS segment_id, seg.ordinal,
         seg.anchor_start_ms AS start_ms, seg.anchor_end_ms AS end_ms, seg.speaker_channel_id AS speaker, seg.text
    FROM recording_sessions rs
    JOIN recording_segments seg ON seg.org_id = rs.org_id AND seg.session_id = rs.id
   WHERE rs.org_id = $1 AND rs.source_type = $2 AND rs.source_ref_id = ANY($3::text[]) AND seg.status = 'final'
   ORDER BY rs.source_ref_id, rs.started_at, rs.id, seg.ordinal`;

/** 白板上能当证据的对象种类（便签 / 文本块）。 */
const NOTE_KINDS: ReadonlySet<string> = new Set(["sticky", "text"]);

/** 解码出的白板对象 → 端口形状：按白板上的顺序（`readObjects` 已按 orderKey 排好）编号，空白跳过。 */
export function projectWhiteboardNotes(
  objects: readonly { id: string; kind: string; text: string; hidden?: boolean }[],
): WhiteboardSourceDoc["notes"] {
  const notes: WhiteboardSourceDoc["notes"][number][] = [];
  for (const o of objects) {
    if (!NOTE_KINDS.has(o.kind) || o.hidden === true || o.text.trim() === "") continue;
    notes.push({ objectId: o.id, kind: o.kind as "sticky" | "text", text: o.text, ordinal: notes.length + 1, authorLabel: null });
  }
  return notes;
}

export class PgEvidenceSources implements ProjectEvidenceSourcePort {
  constructor(
    private readonly db: DatabasePort,
    private readonly whiteboardDecoder: Pick<WhiteboardUpdateValidator, "objects"> = new WorkerWhiteboardUpdateValidator(),
  ) {}

  async surveysOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly SurveySourceDoc[]>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; model: SurveyModelJson | null }>(
        `SELECT sw.id, sw.document->'model' AS model
           FROM project_resource_links l
           JOIN survey_workspaces sw ON sw.org_id = l.org_id AND sw.id = l.resource_id
          WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'survey'
          ORDER BY l.linked_at, sw.id`,
        [orgId, projectId],
      );
      return guard(ref, r.rows.map((row) => projectSurveyModel(row.id, row.model)));
    });
  }

  async transcriptionsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly TranscriptionSourceDoc[]>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const heads = await s.query<{ id: string; name: string }>(
        `SELECT t.id, t.name
           FROM project_resource_links l
           JOIN personal_transcriptions t ON t.org_id = l.org_id AND t.id = l.resource_id
          WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'personal_transcription'
          ORDER BY l.linked_at, t.id`,
        [orgId, projectId],
      );
      if (heads.rows.length === 0) return guard(ref, []);
      const segs = await s.query<SegmentSqlRow>(SEGMENTS_SQL, [orgId, "personal", heads.rows.map((h) => h.id)]);
      const byOwner = new Map<string, TranscriptSegmentSource[]>();
      for (const row of segs.rows) {
        const list = byOwner.get(row.owner_id) ?? [];
        list.push(toSegment(row));
        byOwner.set(row.owner_id, list);
      }
      return guard(
        ref,
        heads.rows.map((h) => ({ transcriptionId: h.id, title: h.name, segments: byOwner.get(h.id) ?? [] })),
      );
    });
  }

  async interviewsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly InterviewSourceDoc[]>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const heads = await s.query<{ id: string; title: string }>(
        `SELECT i.id, i.title FROM interview_sessions i
           ${INTERVIEW_LINK_JOIN}
          WHERE i.org_id = $1 AND ${INTERVIEW_IN_PROJECT}
          ORDER BY i.created_at, i.id`,
        [orgId, projectId],
      );
      if (heads.rows.length === 0) return guard(ref, []);
      const ids = heads.rows.map((h) => h.id);
      const segs = await s.query<SegmentSqlRow>(SEGMENTS_SQL, [orgId, "interview", ids]);
      const quotes = await s.query<{ interview_id: string; quote_id: string; speaker: string | null; text: string }>(
        `SELECT q.interview_id, q.id AS quote_id, sub.display_name AS speaker, q.text
           FROM interview_quotes q
           LEFT JOIN interview_subjects sub ON sub.org_id = q.org_id AND sub.id = q.subject_id
          WHERE q.org_id = $1 AND q.interview_id = ANY($2::text[])
          ORDER BY q.interview_id, q.created_at, q.id`,
        [orgId, ids],
      );
      const segBy = new Map<string, TranscriptSegmentSource[]>();
      for (const row of segs.rows) {
        const list = segBy.get(row.owner_id) ?? [];
        list.push(toSegment(row));
        segBy.set(row.owner_id, list);
      }
      const quoteBy = new Map<string, InterviewSourceDoc["quotes"][number][]>();
      for (const q of quotes.rows) {
        const list = quoteBy.get(q.interview_id) ?? [];
        list.push({ quoteId: q.quote_id, speakerLabel: q.speaker, text: q.text });
        quoteBy.set(q.interview_id, list);
      }
      return guard(
        ref,
        heads.rows.map((h) => ({
          interviewId: h.id,
          title: h.title,
          segments: segBy.get(h.id) ?? [],
          quotes: quoteBy.get(h.id) ?? [],
        })),
      );
    });
  }

  async researchSessionsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly ResearchSourceDoc[]>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; title: string; sources: unknown }>(
        `SELECT g.id, g.title, rt.state->'sources' AS sources
           FROM project_resource_links l
           JOIN guided_research_sessions g ON g.org_id = l.org_id AND g.id = l.resource_id
           LEFT JOIN guided_research_runtime rt ON rt.org_id = g.org_id AND rt.session_id = g.id
          WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'guided_research'
          ORDER BY l.linked_at, g.id`,
        [orgId, projectId],
      );
      return guard(
        ref,
        r.rows.map((row) => ({
          sessionId: row.id,
          title: row.title,
          sources: (Array.isArray(row.sources) ? (row.sources as unknown[]) : []).flatMap((src) => {
            const x = src as {
              id?: unknown; title?: unknown; url?: unknown; content?: unknown; decision?: unknown;
              presentation?: { summary?: unknown } | null;
            };
            if (typeof x.id !== "string" || x.id === "" || x.decision !== "accepted") return [];
            const summary = asString(x.presentation?.summary) || asString(x.content);
            return [{ sourceId: x.id, title: asString(x.title), url: asString(x.url), summary }];
          }),
        })),
      );
    });
  }

  async whiteboardsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly WhiteboardSourceDoc[]>> {
    const ref = { kind: "project" as const, id: projectId };
    const rows = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; name: string; snapshot: Buffer | null }>(
        `SELECT w.id::text AS id, w.name, d.snapshot
           FROM project_resource_links l
           JOIN whiteboards w ON w.org_id = l.org_id AND w.id::text = l.resource_id
           LEFT JOIN whiteboard_documents d ON d.org_id = w.org_id AND d.board_id = w.id
          WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'whiteboard'
          ORDER BY l.linked_at, w.id`,
        [orgId, projectId],
      );
      return r.rows;
    });
    // 解码在事务之外做（worker 往返不占着数据库连接）；快照是已提交的那一份。
    const docs: WhiteboardSourceDoc[] = [];
    for (const row of rows) {
      const snapshot = row.snapshot === null ? null : new Uint8Array(row.snapshot);
      const objects = snapshot === null || snapshot.byteLength === 0 ? [] : await this.whiteboardDecoder.objects(snapshot);
      docs.push({ boardId: row.id, title: row.name, notes: projectWhiteboardNotes(objects) });
    }
    return guard(ref, docs);
  }

  async chatThreadProject(orgId: OrgId, threadId: string): Promise<{ readonly projectId: string; readonly title: string } | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ project_id: string | null; title: string }>(
        `SELECT project_id, title FROM chat_threads WHERE org_id = $1 AND id = $2`,
        [orgId, threadId],
      );
      const row = r.rows[0];
      if (row === undefined || row.project_id === null) return null;
      return { projectId: row.project_id, title: row.title };
    });
  }
}
