import { research as C } from "@repo/contracts";
import { z } from "zod";
import { quoteReferenceMatchSchema } from "./guided-report-quote-references";

export const sourceRelevanceOutputSchema = C.GuidedResearchEvidenceModelOutput.extend({ evaluations: C.GuidedResearchEvidenceModelOutput.shape.evaluations.element.extend({ presentation: C.GuidedResearchSourcePresentation.optional() }).array().min(1).max(8) });

export const sourceRelevanceSemanticCodes = ["invalid_json", "count", "unknown_chunk", "duplicate_chunk", "contradiction", "task_question", "verbatim_quote", "missing_chunk"] as const;
export type SourceRelevanceSemanticCode = typeof sourceRelevanceSemanticCodes[number];
export type SourceRelevanceIssueCode = SourceRelevanceSemanticCode | z.ZodIssueCode;
export const sourceRelevanceIssueCodes: ReadonlySet<string> = new Set([...Object.values(z.ZodIssueCode), ...sourceRelevanceSemanticCodes]);
const evaluation = sourceRelevanceOutputSchema.shape.evaluations.element;
export const sourceRelevanceEvaluationFields: ReadonlySet<string> = new Set(Object.keys(evaluation.shape));
export const sourceRelevanceMatchFields: ReadonlySet<string> = new Set([...Object.keys(evaluation.shape.matches.element.shape), ...Object.keys(quoteReferenceMatchSchema.shape)]);
export const sourceRelevancePresentationFields: ReadonlySet<string> = new Set(Object.keys(C.GuidedResearchSourcePresentation.shape));
