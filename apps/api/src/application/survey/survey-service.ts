import { isDeepStrictEqual } from "node:util";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { survey } from "@repo/contracts";
import {
  validateSurveyQuestions,
  validateSurveyAnswer,
  visibleSurveyQuestions,
} from "@repo/contracts/survey-question-types";
import type {
  SurveyDraftInput,
  SurveyRuntime,
  SurveySubmissionInput,
} from "@repo/contracts/survey-runtime";
import type { OrgId } from "../../domain/org-id";

export interface SurveyRecord {
  ownerId: string;
  model: SurveyRuntime;
  receipts: Record<string, { hash: string; responseId: string }>;
}
export interface SurveyAttachmentClaim {
  publicationVersion: number;
  submissionId: string;
  uploadSessionToken?: string;
  responseId: string;
  references: { questionId: string; attachmentIds: string[] }[];
}
export interface SurveyTransaction {
  claimAttachments(input: SurveyAttachmentClaim): Promise<void>;
}
export interface SurveyRepository {
  list(orgId: OrgId, ownerId: string): Promise<SurveyRuntime[]>;
  create(orgId: OrgId, record: SurveyRecord): Promise<void>;
  transact<T>(
    orgId: OrgId,
    id: string,
    work: (
      record: SurveyRecord,
      transaction?: SurveyTransaction,
    ) => T | Promise<T>,
  ): Promise<T>;
  delete(
    orgId: OrgId,
    id: string,
    ownerId: string,
    version: number,
  ): Promise<void>;
}
export const SURVEY_REPOSITORY = Symbol("SurveyRepository");
export class SurveyError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "version_conflict"
      | "invalid_survey"
      | "closed"
      | "expired"
      | "invalid_answers"
      | "submission_conflict"
      | "invalid_report"
      | "capacity_reached",
  ) {
    super(code);
  }
}
const hash = (value: string) => createHash("sha256").update(value).digest();
export class SurveyService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly now = () => new Date(),
  ) {}
  private revisions(model: SurveyRuntime): SurveyRuntime {
    // Legacy JSON aggregates predate the independent answer clock. Unknown report
    // provenance stays null so an old snapshot is conservatively shown as stale.
    model.answerRevision ??= 0;
    model.reportBasisAnswerRevision ??= null;
    return model;
  }
  private transact<T>(
    orgId: OrgId,
    id: string,
    work: (
      record: SurveyRecord,
      transaction?: SurveyTransaction,
    ) => T | Promise<T>,
  ): Promise<T> {
    return this.repo.transact(orgId, id, (record, transaction) => {
      this.revisions(record.model);
      return work(record, transaction);
    });
  }
  async list(orgId: OrgId, actor: string) {
    return (await this.repo.list(orgId, actor)).map((model) =>
      this.revisions(model),
    );
  }
  async create(orgId: OrgId, actor: string, input: SurveyDraftInput) {
    const model: SurveyRuntime = {
      ...input,
      id: randomUUID(),
      version: 1,
      answerRevision: 0,
      updatedAt: this.now().toISOString(),
      responses: [],
      publication: null,
      report: null,
      reportBasisVersion: null,
      reportBasisAnswerRevision: null,
      reportGeneratedAt: null,
    };
    await this.repo.create(orgId, { ownerId: actor, model, receipts: {} });
    return model;
  }
  private own(record: SurveyRecord, actor: string, version?: number) {
    if (record.ownerId !== actor) throw new SurveyError("not_found");
    if (version !== undefined && version !== record.model.version)
      throw new SurveyError("version_conflict");
  }
  get(orgId: OrgId, actor: string, id: string) {
    return this.transact(orgId, id, (r) => {
      this.own(r, actor);
      return r.model;
    });
  }
  delete(orgId: OrgId, actor: string, id: string, version: number) {
    return this.repo.delete(orgId, id, actor, version);
  }
  change(
    orgId: OrgId,
    actor: string,
    id: string,
    version: number,
    work: (model: SurveyRuntime) => void,
  ) {
    return this.transact(orgId, id, (r) => {
      this.own(r, actor, version);
      work(r.model);
      r.model.version++;
      r.model.updatedAt = this.now().toISOString();
      return r.model;
    });
  }
  save(
    orgId: OrgId,
    actor: string,
    id: string,
    version: number,
    input: SurveyDraftInput,
  ) {
    return this.change(orgId, actor, id, version, (m) => {
      if (m.publication && !isDeepStrictEqual(m.questions, input.questions))
        throw new SurveyError("closed");
      m.title = input.title;
      m.questions = input.questions;
      m.template = input.template;
    });
  }
  publish(
    orgId: OrgId,
    actor: string,
    id: string,
    version: number,
    expiresAt?: string,
  ) {
    return this.change(orgId, actor, id, version, (m) => {
      if (m.publication) throw new SurveyError("closed");
      if (
        !m.questions.some(
          (q) => !["description", "page_break"].includes(q.type),
        ) ||
        validateSurveyQuestions(m.questions).length
      )
        throw new SurveyError("invalid_survey");
      const end = expiresAt
        ? new Date(expiresAt)
        : new Date(this.now().getTime() + 30 * 86400000);
      if (end.getTime() <= this.now().getTime())
        throw new SurveyError("expired");
      // Locator is untrusted routing only: the 256-bit secret is checked before any disclosure.
      const token = `${Buffer.from(JSON.stringify([orgId, m.id])).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
      m.publication = {
        token,
        status: "collecting",
        questions: structuredClone(m.questions),
        version: m.version,
        expiresAt: end.toISOString(),
      };
    });
  }
  close(orgId: OrgId, actor: string, id: string, version: number) {
    return this.change(orgId, actor, id, version, (m) => {
      if (!m.publication) throw new SurveyError("closed");
      m.publication.status = "closed";
    });
  }
  review(
    orgId: OrgId,
    actor: string,
    id: string,
    version: number,
    responseId: string,
    quality: "normal" | "review",
  ) {
    return this.transact(orgId, id, (record) => {
      this.own(record, actor, version);
      const m = record.model;
      const response = m.responses.find((r) => r.id === responseId);
      if (!response) throw new SurveyError("not_found");
      // Quality is answer state, not a template edit. Repeating the same decision
      // is a no-op; simultaneous different decisions use transaction order.
      if (response.quality !== quality) {
        response.quality = quality;
        m.answerRevision++;
        m.updatedAt = this.now().toISOString();
      }
      return m;
    });
  }
  report(orgId: OrgId, actor: string, id: string, version: number) {
    return this.change(orgId, actor, id, version, (m) => {
      const responses = m.responses;
      if (!responses.length) throw new SurveyError("invalid_report");
      const report = survey.compileSurveyReport(
        m.template,
        m.publication?.questions ?? m.questions,
        responses,
      );
      if (
        report.issues.length ||
        report.sections.some((s) => s.blocks.some((b) => b.issues.length))
      )
        throw new SurveyError("invalid_report");
      m.report = structuredClone(report);
      m.reportBasisVersion = m.version;
      m.reportBasisAnswerRevision = m.answerRevision;
      m.reportGeneratedAt = this.now().toISOString();
    });
  }
  private locate(token: string): [OrgId, string] {
    try {
      if (token.length > 2048 || token.split(".").length !== 2) throw 0;
      const v: unknown = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64url").toString(),
      );
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        v.some((x) => typeof x !== "string" || !x.length || x.length > 200)
      )
        throw 0;
      return v as [OrgId, string];
    } catch {
      throw new SurveyError("not_found");
    }
  }
  private publicRecord(record: SurveyRecord, token: string) {
    const p = record.model.publication;
    if (!p || !timingSafeEqual(hash(p.token), hash(token)))
      throw new SurveyError("not_found");
    if (p.status !== "collecting") throw new SurveyError("closed");
    if (new Date(p.expiresAt).getTime() <= this.now().getTime())
      throw new SurveyError("expired");
    return p;
  }
  publicGet(token: string) {
    const [orgId, id] = this.locate(token);
    return this.transact(orgId, id, (r) => {
      const p = this.publicRecord(r, token);
      return {
        id,
        title: r.model.title,
        questions: p.questions,
        version: p.version,
        expiresAt: p.expiresAt,
      };
    });
  }
  submit(token: string, input: SurveySubmissionInput) {
    const [orgId, id] = this.locate(token);
    return this.transact(orgId, id, (r, transaction) => {
      const p = this.publicRecord(r, token);
      const fingerprint = hash(JSON.stringify(input)).toString("hex");
      const receiptKey = hash(input.submissionId).toString("hex");
      const receipt = r.receipts[receiptKey];
      if (receipt) {
        if (receipt.hash !== fingerprint)
          throw new SurveyError("submission_conflict");
        return { responseId: receipt.responseId, replayed: true };
      }
      if (
        r.model.responses.length >= 10000 ||
        Buffer.byteLength(JSON.stringify(r)) +
          Buffer.byteLength(JSON.stringify(input)) >
          16 * 1024 * 1024
      )
        throw new SurveyError("capacity_reached");
      const answers = new Map(
        input.answers.map((a) => [a.questionId, a.value]),
      );
      if (
        answers.size !== input.answers.length ||
        input.answers.some(
          (a) => !p.questions.some((q) => q.id === a.questionId),
        )
      )
        throw new SurveyError("invalid_answers");
      const activeQuestions = visibleSurveyQuestions(
        p.questions,
        Object.fromEntries(answers),
      );
      const activeIds = new Set(
        activeQuestions
          .filter((q) => !["description", "page_break"].includes(q.type))
          .map((q) => q.id),
      );
      if (input.answers.some((a) => !activeIds.has(a.questionId)))
        throw new SurveyError("invalid_answers");
      for (const q of activeQuestions) {
        if (validateSurveyAnswer(q, answers.get(q.id)).length)
          throw new SurveyError("invalid_answers");
      }
      const responseId = randomUUID();
      const commit = () => {
        r.model.responses.push({
          id: responseId,
          quality: "normal",
          submittedAt: this.now().toISOString(),
          role: input.role,
          companySize: input.companySize,
          durationSeconds: input.durationSeconds,
          answers: input.answers,
        });
        r.receipts[receiptKey] = { hash: fingerprint, responseId };
        r.model.answerRevision++;
        r.model.updatedAt = this.now().toISOString();
        return { responseId, replayed: false };
      };
      const references = activeQuestions
        .filter((q) => q.type === "file" || q.type === "signature")
        .flatMap((q) => {
          const value = answers.get(q.id);
          return Array.isArray(value) && value.length
            ? [{ questionId: q.id, attachmentIds: value }]
            : [];
        });
      if (!references.length) return commit();
      if (!transaction) throw new SurveyError("invalid_answers");
      return transaction
        .claimAttachments({
          publicationVersion: p.version,
          submissionId: input.submissionId,
          uploadSessionToken: input.uploadSessionToken,
          responseId,
          references,
        })
        .then(commit);
    });
  }
}
