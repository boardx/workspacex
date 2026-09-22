import { createHash, timingSafeEqual } from "node:crypto";
import type {
  DatabasePort,
  TenantSession,
} from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import {
  SurveyError,
  type SurveyRecord,
} from "../../application/survey/survey-service";
import type {
  StoredSurveyAttachment,
  AttachmentRepository,
  AttachmentContext,
} from "../../application/survey/survey-attachment-service";
import type { PhysicalPurgePort } from "../../application/files/physical-delete-ports";
import {
  SURVEY_UPLOAD_MAX_BYTES,
  SURVEY_UPLOAD_MAX_FILES,
  SurveyAttachmentError,
} from "../../application/survey/survey-attachment-service";
const extensionMimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};
export const capabilityHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export interface ClaimSurveyAttachmentsInput {
  orgId: OrgId;
  surveyId: string;
  publicationVersion: number;
  submissionId: string;
  uploadSessionToken?: string;
  responseId: string;
  references: { questionId: string; attachmentIds: string[] }[];
}
/** Called only inside the aggregate's locked transaction, after publication and answers validation. */
export async function claimSurveyAttachments(
  s: TenantSession,
  input: ClaimSurveyAttachmentsInput,
): Promise<void> {
  const ids = input.references.flatMap((r) => r.attachmentIds);
  if (!ids.length) return;
  if (!input.uploadSessionToken || new Set(ids).size !== ids.length)
    throw new SurveyError("invalid_answers");
  const hash = capabilityHash(input.uploadSessionToken);
  const session = await s.query<{ response_id: string | null }>(
    `SELECT response_id FROM survey_upload_sessions WHERE org_id=$1 AND survey_id=$2 AND token_hash=$3 AND submission_id=$4 AND publication_version=$5 AND expires_at>now() FOR UPDATE`,
    [
      input.orgId,
      input.surveyId,
      hash,
      input.submissionId,
      input.publicationVersion,
    ],
  );
  if (!session.rows[0] || session.rows[0].response_id)
    throw new SurveyError("invalid_answers");
  const rows = await s.query<{ id: string; question_id: string }>(
    `SELECT id,question_id FROM survey_attachments WHERE org_id=$1 AND survey_id=$2 AND session_hash=$3 AND id=ANY($4::text[]) AND status='ready' AND expires_at>now() FOR UPDATE`,
    [input.orgId, input.surveyId, hash, ids],
  );
  if (
    rows.rows.length !== ids.length ||
    input.references.some((ref) =>
      ref.attachmentIds.some(
        (id) =>
          !rows.rows.some(
            (row) => row.id === id && row.question_id === ref.questionId,
          ),
      ),
    )
  )
    throw new SurveyError("invalid_answers");
  await s.query(
    `UPDATE survey_attachments SET status='claimed',response_id=$3 WHERE org_id=$1 AND id=ANY($2::text[])`,
    [input.orgId, ids, input.responseId],
  );
  await s.query(
    `UPDATE survey_upload_sessions SET response_id=$3 WHERE org_id=$1 AND token_hash=$2`,
    [input.orgId, hash, input.responseId],
  );
}
export class PgSurveyAttachmentRepository implements AttachmentRepository {
  constructor(readonly db: DatabasePort) {}
  async withPublication<T>(
    token: string,
    work: (ctx: AttachmentContext) => Promise<T>,
  ): Promise<T> {
    let locator: unknown;
    try {
      if (token.length > 2048 || token.split(".").length !== 2) throw 0;
      locator = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64url").toString(),
      );
    } catch {
      throw new SurveyAttachmentError("not_found");
    }
    if (
      !Array.isArray(locator) ||
      locator.length !== 2 ||
      locator.some((x) => typeof x !== "string" || !x.length || x.length > 200)
    )
      throw new SurveyAttachmentError("not_found");
    const [orgId, surveyId] = locator as [OrgId, string];
    return this.db.withTenant(orgId, async (s) => {
      const row = await s.query<{ document: SurveyRecord }>(
        "SELECT document FROM survey_workspaces WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, surveyId],
      );
      const model = row.rows[0]?.document.model;
      const publication = model?.publication;
      if (
        !publication ||
        !timingSafeEqual(
          Buffer.from(capabilityHash(publication.token), "hex"),
          Buffer.from(capabilityHash(token), "hex"),
        )
      )
        throw new SurveyAttachmentError("not_found");
      if (
        publication.status !== "collecting" ||
        Date.parse(publication.expiresAt) <= Date.now()
      )
        throw new SurveyAttachmentError("closed");
      return work({ s, orgId, surveyId, publication });
    });
  }
  async withOwner<T>(
    orgId: OrgId,
    surveyId: string,
    ownerId: string,
    work: (s: TenantSession) => Promise<T>,
  ): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query(
        "SELECT id FROM survey_workspaces WHERE org_id=$1 AND id=$2 AND owner_id=$3 FOR UPDATE",
        [orgId, surveyId, ownerId],
      );
      if (!r.rows.length) throw new SurveyAttachmentError("not_found");
      return work(s);
    });
  }

  async createSession(
    token: string,
    submissionId: string,
    sessionToken: string,
  ) {
    return this.withPublication(token, async (c) => {
      const count = await c.s.query<{ n: string }>(
        "SELECT count(*) n FROM survey_upload_sessions WHERE org_id=$1 AND survey_id=$2 AND expires_at>now()",
        [c.orgId, c.surveyId],
      );
      if (Number(count.rows[0]?.n) >= 10000)
        throw new SurveyAttachmentError("limit_exceeded");
      const expiresAt = new Date(
        Math.min(
          Date.parse(c.publication.expiresAt),
          Date.now() + 24 * 3600 * 1000,
        ),
      ).toISOString();
      await c.s.query(
        "INSERT INTO survey_upload_sessions(org_id,survey_id,token_hash,submission_id,publication_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          c.orgId,
          c.surveyId,
          capabilityHash(sessionToken),
          submissionId,
          c.publication.version,
          expiresAt,
        ],
      );
      return { expiresAt, orgId: c.orgId };
    });
  }
  private async session(c: AttachmentContext, token: string) {
    const hash = capabilityHash(token);
    const r = await c.s.query<{ expires_at: Date }>(
      `SELECT expires_at FROM survey_upload_sessions WHERE org_id=$1 AND survey_id=$2 AND token_hash=$3 AND publication_version=$4 AND response_id IS NULL AND expires_at>now() FOR UPDATE`,
      [c.orgId, c.surveyId, hash, c.publication.version],
    );
    if (!r.rows[0]) throw new SurveyAttachmentError("not_found");
    return { hash, expiresAt: r.rows[0].expires_at };
  }
  async reserve(
    token: string,
    sessionToken: string,
    q: string,
    file: StoredSurveyAttachment,
    sha: string,
  ) {
    return this.withPublication(token, async (c) => {
      const session = await this.session(c, sessionToken);
      const question = c.publication.questions.find((x) => x.id === q);
      const questionType = question?.type as string | undefined;
      if (!question || !["file", "signature"].includes(questionType ?? ""))
        throw new SurveyAttachmentError("invalid_attachment");
      const config = (
        question as unknown as {
          config?: {
            maxFiles?: number;
            maxFileBytes?: number;
            allowedExtensions?: string[];
          };
        }
      ).config;
      if (questionType === "signature" && file.mime !== "image/png")
        throw new SurveyAttachmentError("invalid_file");
      if (
        file.sizeBytes >
          Math.min(
            config?.maxFileBytes ?? SURVEY_UPLOAD_MAX_BYTES,
            SURVEY_UPLOAD_MAX_BYTES,
          ) ||
        (config?.allowedExtensions &&
          !config.allowedExtensions.some(
            (ext) => extensionMimes[ext.toLowerCase()] === file.mime,
          ))
      )
        throw new SurveyAttachmentError("invalid_file");
      const count = await c.s.query<{
        n: string;
        bytes: string;
        question_count: string;
      }>(
        `SELECT count(*) n,coalesce(sum(size_bytes),0) bytes,count(*) FILTER(WHERE question_id=$3) question_count FROM survey_attachments WHERE org_id=$1 AND session_hash=$2 AND status<>'deleted'`,
        [c.orgId, session.hash, q],
      );
      const row = count.rows[0]!;
      if (
        Number(row.n) >= 50 ||
        Number(row.bytes) + file.sizeBytes > 32 * 1024 * 1024 ||
        Number(row.question_count) >=
          (questionType === "signature"
            ? 1
            : Math.min(
                config?.maxFiles ?? SURVEY_UPLOAD_MAX_FILES,
                SURVEY_UPLOAD_MAX_FILES,
              ))
      )
        throw new SurveyAttachmentError("limit_exceeded");
      const total = await c.s.query<{ bytes: string }>(
        `SELECT coalesce(sum(size_bytes),0) bytes FROM survey_attachments WHERE org_id=$1 AND survey_id=$2`,
        [c.orgId, c.surveyId],
      );
      if (Number(total.rows[0]?.bytes) + file.sizeBytes > 1024 * 1024 * 1024)
        throw new SurveyAttachmentError("limit_exceeded");
      await c.s.query(
        `INSERT INTO survey_attachments(org_id,id,survey_id,session_hash,question_id,object_key,name,mime,size_bytes,sha256,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
        [
          c.orgId,
          file.attachmentId,
          c.surveyId,
          session.hash,
          q,
          file.objectKey,
          file.name,
          file.mime,
          file.sizeBytes,
          sha,
          session.expiresAt,
        ],
      );
    });
  }
  async authorize(token: string, sessionToken: string, q: string) {
    return this.withPublication(token, async (c) => {
      await this.session(c, sessionToken);
      if (
        !c.publication.questions.some(
          (x) => x.id === q && ["file", "signature"].includes(x.type as string),
        )
      )
        throw new SurveyAttachmentError("invalid_attachment");
    });
  }
  async ready(
    token: string,
    sessionToken: string,
    id: string,
    write: () => Promise<void>,
  ) {
    return this.withPublication(token, async (c) => {
      const session = await this.session(c, sessionToken);
      const locked = await c.s.query(
        `SELECT id FROM survey_attachments WHERE org_id=$1 AND id=$2 AND session_hash=$3 AND status='pending' FOR UPDATE`,
        [c.orgId, id, session.hash],
      );
      if (!locked.rows.length) throw new SurveyAttachmentError("not_found");
      await write();
      const r = await c.s.query(
        `UPDATE survey_attachments SET status='ready' WHERE org_id=$1 AND id=$2 AND session_hash=$3 AND status='pending' RETURNING id`,
        [c.orgId, id, session.hash],
      );
      if (!r.rows.length) throw new SurveyAttachmentError("not_found");
    });
  }
  async remove(token: string, sessionToken: string, q: string, id: string) {
    return this.withPublication(token, async (c) => {
      const session = await this.session(c, sessionToken);
      const r = await c.s.query(
        `UPDATE survey_attachments SET status='deleted',expires_at=now() WHERE org_id=$1 AND id=$2 AND session_hash=$3 AND question_id=$4 AND status IN ('pending','ready') RETURNING id`,
        [c.orgId, id, session.hash, q],
      );
      if (!r.rows.length) throw new SurveyAttachmentError("not_found");
    });
  }
  private row(
    row:
      | {
          id: string;
          name: string;
          mime: string;
          size_bytes: number;
          object_key: string;
        }
      | undefined,
  ): StoredSurveyAttachment {
    if (!row) throw new SurveyAttachmentError("not_found");
    return {
      attachmentId: row.id,
      name: row.name,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      objectKey: row.object_key,
    };
  }
  async readPublic(token: string, sessionToken: string, q: string, id: string) {
    return this.withPublication(token, async (c) => {
      const session = await this.session(c, sessionToken);
      const r = await c.s.query<{
        id: string;
        name: string;
        mime: string;
        size_bytes: number;
        object_key: string;
      }>(
        `SELECT id,name,mime,size_bytes,object_key FROM survey_attachments WHERE org_id=$1 AND id=$2 AND session_hash=$3 AND question_id=$4 AND status='ready'`,
        [c.orgId, id, session.hash, q],
      );
      return this.row(r.rows[0]);
    });
  }
  async readOwner(
    org: OrgId,
    survey: string,
    owner: string,
    response: string,
    id: string,
  ) {
    return this.withOwner(org, survey, owner, async (s) => {
      const r = await s.query<{
        id: string;
        name: string;
        mime: string;
        size_bytes: number;
        object_key: string;
      }>(
        `SELECT id,name,mime,size_bytes,object_key FROM survey_attachments WHERE org_id=$1 AND survey_id=$2 AND id=$3 AND response_id=$4 AND status='claimed'`,
        [org, survey, id, response],
      );
      return this.row(r.rows[0]);
    });
  }
  async cleanup(org: OrgId, purge: PhysicalPurgePort) {
    return this.db.withTenant(org, async (s) => {
      const rows = await s.query<{ id: string; object_key: string }>(
        `SELECT id,object_key FROM survey_attachments WHERE org_id=$1 AND status<>'claimed' AND expires_at<now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [org],
      );
      let removed = 0;
      for (const row of rows.rows) {
        if (!/^survey-attachments\/[0-9a-f-]{36}$/.test(row.object_key))
          throw new SurveyAttachmentError("invalid_attachment");
        const result = await purge.purgeAll([row.object_key]);
        if (result[0]?.deleted) {
          await s.query(
            "DELETE FROM survey_attachments WHERE org_id=$1 AND id=$2",
            [org, row.id],
          );
          removed++;
        }
      }
      await s.query(
        `DELETE FROM survey_upload_sessions u WHERE u.org_id=$1 AND u.expires_at<now() AND NOT EXISTS(SELECT 1 FROM survey_attachments a WHERE a.org_id=u.org_id AND a.session_hash=u.token_hash)`,
        [org],
      );
      return removed;
    });
  }
}
