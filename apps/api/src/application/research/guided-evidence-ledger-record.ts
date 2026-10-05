import { z } from "zod";
import { research as C } from "@repo/contracts";
const match = C.GuidedResearchEvidenceModelOutput.shape.evaluations.element.shape.matches.element.shape;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GUIDED_EVIDENCE_VALIDATOR_VERSION = 1;
export const GUIDED_EVIDENCE_CHUNK_SIZE = 6000;
export const GUIDED_EVIDENCE_MATCH_LIMIT = 16384;
/** Server-private facts. Public projection must never return this raw schema. */
export const GuidedEvidenceLedgerRecord = z.object({
  evidenceId: z.string().min(1), questionKey: hash, sectionId: z.string().min(1),
  questionTextHash: hash, basis: hash, taskId: z.string().min(1), sourceId: z.string().min(1),
  sourceUrl: z.string().url(), documentUrl: z.string().url(), sourceRetrievedAt: z.string(), documentRetrievedAt: z.string(),
  documentHash: hash, materialKind: z.literal("fetched_document"),
  chunkId: z.string().min(1), chunkStart: z.number().int().nonnegative(),
  quoteStart: z.number().int().nonnegative(), quoteEnd: z.number().int().nonnegative(),
  quote: match.quote, quoteHash: hash, insight: match.insight,
  relevance: z.enum(["direct", "context"]), verifiedAt: z.string().datetime(),
  validatorVersion: z.literal(GUIDED_EVIDENCE_VALIDATOR_VERSION),
}).strict().refine(record => record.quoteEnd > record.quoteStart && record.quoteStart >= record.chunkStart, "valid original material span required");
export type GuidedEvidenceLedgerRecord = z.infer<typeof GuidedEvidenceLedgerRecord>;
export const GuidedEvidenceLedger = z.object({
  validatorVersion: z.literal(GUIDED_EVIDENCE_VALIDATOR_VERSION),
  records: z.array(GuidedEvidenceLedgerRecord).max(GUIDED_EVIDENCE_MATCH_LIMIT),
}).strict();
export type GuidedEvidenceLedger = z.infer<typeof GuidedEvidenceLedger>;
