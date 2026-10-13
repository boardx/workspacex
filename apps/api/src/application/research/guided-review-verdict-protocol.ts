import type { ReportAudit } from "./guided-report-evidence";
import { research as C } from "@repo/contracts";
import { z } from "zod";
import { extractJson } from "./guided-structured-json";

const verdicts = { answered: "supported_answer", gap: "explicit_evidence_gap", missing: "omitted_answer" } as const;
type Verdict = keyof typeof verdicts;
const proofQuestion = C.GuidedResearchChapterReviewModelOutput.shape.questions.element.extend({ chapterParagraphId: z.string().min(1).max(100), evidenceQuoteIds: z.array(z.string().min(1).max(100)).max(64) });
export const guidedGapProofSchema = C.GuidedResearchChapterReviewModelOutput.extend({ questions: z.array(proofQuestion).min(1).max(64) });
const wireVerdict = z.enum([verdicts.answered, verdicts.gap, verdicts.missing]);
/** Recover only schema-recognized enum identities for negative format-verdict locks.
 * Other malformed fields remain untouched and never become an accepted review. */
export function canonicalReviewVerdicts(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("questions" in raw) || !Array.isArray(raw.questions)) return raw;
  return { ...raw, questions: raw.questions.map(q => {
    if (!q || typeof q !== "object" || !("status" in q)) return q;
    const selected = wireVerdict.safeParse(q.status);
    return selected.success ? { ...q, status: canonical(selected.data) } : q;
  }) };
}
const ordinaryWireSchema = C.GuidedResearchChapterReviewModelOutput.extend({ questions: z.array(C.GuidedResearchChapterReviewModelOutput.shape.questions.element.extend({ status: wireVerdict })).min(1).max(64) });
const wireSchema = guidedGapProofSchema.extend({ questions: z.array(proofQuestion.extend({ status: wireVerdict })).min(1).max(64) });
function canonical(value: unknown): unknown {
  return Object.entries(verdicts).find(([, wire]) => wire === value)?.[0] ?? value;
}
interface Node { properties?: Record<string, Node>; items?: Node; anyOf?: Node[]; enum?: unknown[] }
/** Exact enum translation only; no inference from prose or rewriting verdicts. */
export function reviewVerdictProtocol(audit: ReportAudit, proof = true): ReportAudit {
  return async (input, validate, publish) => {
    const schema = input.responseSchema && structuredClone(input.responseSchema);
    const items = (schema?.schema as Node | undefined)?.properties?.questions?.items;
    for (const branch of items?.anyOf ?? (items ? [items] : [])) {
      const status = branch.properties?.status;
      if (status?.enum) status.enum = status.enum.map(value => typeof value === "string" && Object.hasOwn(verdicts, value) ? verdicts[value as Verdict] : value);
    }
    return audit({ ...input, responseSchema: schema,
      system: `${input.system} For the output status field use these unambiguous labels exclusively: supported_answer means the chapter provides a supported answer; explicit_evidence_gap means the chapter explains the specific unavailable fact and concrete verification; omitted_answer means the CHAPTER omits a supported answer or an adequate explicit gap explanation. Unavailable source evidence alone never means omitted_answer. These correspond one-to-one to answered, gap, missing in existing input verdicts; preserve their meaning during any format-only correction. Return only the final selected verdict with concise rationale within the response schema limit, never deliberation or provisional/self-correcting judgments.`,
    }, text => {
      let raw: unknown;
      try { raw = extractJson(text); } catch { return validate(text); }
      const parsed = (proof ? wireSchema : ordinaryWireSchema).safeParse(raw);
      if (!parsed.success) return validate(text); // Legacy canonical replies still undergo the original strict schema.
      return validate(JSON.stringify({ ...parsed.data, questions: parsed.data.questions.map(q => ({ ...q, status: canonical(q.status) })) }));
    }, publish);
  };
}
