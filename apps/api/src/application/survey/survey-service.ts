import { isDeepStrictEqual } from "node:util";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { survey } from "@repo/contracts";
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
export interface SurveyRepository {
  list(orgId: OrgId, ownerId: string): Promise<SurveyRuntime[]>;
  create(orgId: OrgId, record: SurveyRecord): Promise<void>;
  transact<T>(
    orgId: OrgId,
    id: string,
    work: (record: SurveyRecord) => T,
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
  list(orgId: OrgId, actor: string) {
    return this.repo.list(orgId, actor);
  }
  async create(orgId: OrgId, actor: string, input: SurveyDraftInput) {
    const model: SurveyRuntime = {
      ...input,
      id: randomUUID(),
      version: 1,
      updatedAt: this.now().toISOString(),
      responses: [],
      publication: null,
      report: null,
      reportBasisVersion: null,
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
    return this.repo.transact(orgId, id, (r) => {
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
    return this.repo.transact(orgId, id, (r) => {
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
        !m.questions.length ||
        new Set(m.questions.map((q) => q.id)).size !== m.questions.length ||
        m.questions.some(
          (q) =>
            !q.title.trim() ||
            ((q.type === "single" ||
              q.type === "multi" ||
              q.type === "scale") &&
              (q.options.length < 2 ||
                new Set(q.options).size !== q.options.length)) ||
            (q.type === "scale" &&
              q.options.some((v) => !v.trim() || !Number.isFinite(Number(v)))),
        )
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
    return this.change(orgId, actor, id, version, (m) => {
      const r = m.responses.find((r) => r.id === responseId);
      if (!r) throw new SurveyError("not_found");
      r.quality = quality;
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
    return this.repo.transact(orgId, id, (r) => {
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
    return this.repo.transact(orgId, id, (r) => {
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
      for (const q of p.questions) {
        const v = answers.get(q.id);
        if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) {
          if (q.required) throw new SurveyError("invalid_answers");
          continue;
        }
        if (q.type === "multi") {
          if (
            !Array.isArray(v) ||
            new Set(v).size !== v.length ||
            v.some((x) => !q.options.includes(x))
          )
            throw new SurveyError("invalid_answers");
        } else if (
          typeof v !== "string" ||
          (q.type === "single" && !q.options.includes(v)) ||
          (q.type === "scale" &&
            (!q.options.includes(v) ||
              !v.trim() ||
              !Number.isFinite(Number(v))))
        )
          throw new SurveyError("invalid_answers");
      }
      const responseId = randomUUID();
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
      r.model.version++;
      r.model.updatedAt = this.now().toISOString();
      return { responseId, replayed: false };
    });
  }
}
