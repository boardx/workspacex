import type { QuestionEvidence, ReportAudit } from "./guided-report-evidence";
import { ResearchRuntimeError } from "./guided-runtime-ports";
import { canonicalReviewVerdicts } from "./guided-review-verdict-protocol";
import { rejectReviewOutput } from "./guided-review-rewrite-feedback";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { ModelResponseSchema } from "../agent-run/ports";
type Review = z.infer<typeof C.GuidedResearchChapterReviewModelOutput>;

export interface ProofReferenceIssue {
  code: "proof_references_invalid"; questionId: string;
  allowedEvidenceQuoteIds: string[]; allowedChapterParagraphIds: string[];
}
export class InvalidProofReferences extends ResearchRuntimeError {
  constructor(readonly validationIssues: ProofReferenceIssue[]) { super("RESEARCH_REPORT_QUALITY_INSUFFICIENT"); }
}
interface SchemaNode {
  [key: string]: unknown;
  properties?: Record<string, SchemaNode>; items?: SchemaNode;
  anyOf?: SchemaNode[]; enum?: unknown[];
}
/** Derive format-only verdict locks from the same already parsed review. */
function proofRepairSchema(schema: ModelResponseSchema | undefined, prior: Partial<Review> | undefined): ModelResponseSchema | undefined {
  if (!schema || !prior) return schema;
  const locked = structuredClone(schema); const fields = (locked.schema as SchemaNode).properties;
  if (!fields) return locked;
  if (typeof prior.supported === "boolean" && fields.supported) fields.supported.enum = [prior.supported];
  if (["adequate", "shallow"].includes(prior.analysisDepth ?? "") && fields.analysisDepth) fields.analysisDepth.enum = [prior.analysisDepth];
  const questions = Array.isArray(prior.questions) ? prior.questions : [];
  for (const branch of fields.questions?.items?.anyOf ?? []) {
    const id = branch.properties?.questionId?.enum?.[0];
    const matching = questions.filter(q => q && q.questionId === id);
    if (matching.length === 1 && branch.properties?.status && ["answered", "gap", "missing"].includes(matching[0]!.status)) branch.properties.status.enum = [matching[0]!.status];
  }
  return locked;
}
/** One existing review-format correction, with no semantic approval or mutation.
 * Proof repair must preserve every original verdict, not merely negative ones. */
export function repairReviewFormat(audit: ReportAudit, evidenceByQuestion: QuestionEvidence[], proof = false): ReportAudit {
  const originalAudit = audit;
  return async (input, validate, publish) => {
    let malformed: string | undefined;
    try {
      return await originalAudit(input, (text) => {
        try { return validate(text); }
        catch (error) { malformed = text; throw error; }
      }, publish);
    } catch (error) {
      if (malformed === undefined || !(error instanceof ResearchRuntimeError)
        || error.reasonCode !== "RESEARCH_REPORT_QUALITY_INSUFFICIENT"
        || (proof && !(error instanceof InvalidProofReferences))) throw error;
      let prior: Partial<Review> | undefined;
      try { const value = JSON.parse(malformed); if (value && typeof value === "object") prior = canonicalReviewVerdicts(value) as Partial<Review>; } catch { /* Non-JSON has no recoverable verdict. */ }
      const preserveVerdict = (text: string) => {
        const repaired = validate(text) as Review;
        const issues = Array.isArray(prior?.issues) ? prior.issues.filter((issue) => typeof issue === "string") : [];
        const questions = Array.isArray(prior?.questions) ? prior.questions.filter((question) => question !== null && typeof question === "object") : [];
        for (const question of questions) {
          const nested = (question as typeof question & { issues?: unknown }).issues;
          if (Array.isArray(nested)) for (const issue of nested) if (typeof issue === "string") issues.push(`${question.questionId}: ${issue}`);
        }
        if ((prior?.supported === false && repaired.supported !== false)
          || (prior?.analysisDepth === "shallow" && repaired.analysisDepth !== "shallow")
          || issues.some((issue) => !repaired.issues.includes(issue))
          || questions.some((question) => question.status === "missing" && repaired.questions.find((item) => item.questionId === question.questionId)?.status !== "missing")
          || (proof && ((typeof prior?.supported === "boolean" && repaired.supported !== prior.supported)
            || (prior?.analysisDepth !== undefined && repaired.analysisDepth !== prior.analysisDepth)
            || questions.some(question => ["answered", "gap", "missing"].includes(question.status) && repaired.questions.find(item => item.questionId === question.questionId)?.status !== question.status)))) {
          throw new ResearchRuntimeError("RESEARCH_REPORT_QUALITY_INSUFFICIENT");
        }
        return repaired;
      };
      try { return await originalAudit({ ...input, ...(proof ? { responseSchema: proofRepairSchema(input.responseSchema, prior) } : {}), user: JSON.stringify({ ...JSON.parse(input.user),
        malformedReview: malformed.slice(0, 50000),
        ...(error instanceof InvalidProofReferences ? { validationIssues: error.validationIssues } : {}),
        repairInstruction: proof
          ? 'Repair the strict proof JSON and reference identities only, never chapter prose or evidence. Preserve supported, analysisDepth, every question status and every substantive issue exactly; do not change the semantic verdict. Each question has ONLY questionId, status, rationale, chapterParagraphId, evidenceQuoteIds. Read unchanged full chapterParagraphs and evidenceByQuestion. Select chapterParagraphId only from that question’s allowed paragraph registry, and evidenceQuoteIds only from its exact directQuoteIds after inspecting the full quotes. Complete backgroundContext is nonselectable; never fabricate an ID from its array position or silently strip IDs. When directQuoteIds is empty evidenceQuoteIds must be empty; otherwise select at least one provided direct ID. All original questions occur exactly once. Repair using validationIssues and the supplied strict response schema. Return JSON, no markdown.'
          : 'Repair the strict REVIEW JSON only, never the chapter or evidence. Preserve every substantive defect and negative verdict. Use exactly questions, supported, analysisDepth, issues at top level; each question has ONLY questionId, status, rationale. Every supplied question ID occurs exactly once. Put all real defects in the top-level issues array. Return JSON, no markdown. Rationale must fit the existing schema and be concise, preserving required verbatim evidence or chapter paragraph for partial coverage.'  }) }, preserveVerdict, publish); }
      catch (repairError) {
        if (repairError instanceof ResearchRuntimeError && repairError.reasonCode === "RESEARCH_REPORT_QUALITY_INSUFFICIENT") rejectReviewOutput(prior, evidenceByQuestion, repairError);
        throw repairError;
      }
    }
  };

}
