/** Review-only read proposal; requires org-admin authorization before repository access. */
import { z } from "zod";
import { AdmissionTestRecord } from "./agent-runtime";
import { CapabilityModelConfigRef } from "./capability-runtime-policy";

const Sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ModelAdmissionHistoryRecord = AdmissionTestRecord.extend({
  seq: Sequence.refine(value => value > 0),
  // Existing rows have no configuration revision. Never label them with today's revision.
  configRevision: CapabilityModelConfigRef.shape.configRevision.nullable(),
}).strict();
const Input = z.object({
  modelId: CapabilityModelConfigRef.shape.capabilityModelId,
  afterSeq: Sequence,
  snapshotSeq: Sequence.nullable(),
  limit: z.number().int().min(1).max(100),
}).strict().refine(input => input.snapshotSeq === null ? input.afterSeq === 0 : input.afterSeq <= input.snapshotSeq,
  "continuations require the original sequence fence");
const Output = z.object({
  modelId: CapabilityModelConfigRef.shape.capabilityModelId,
  snapshotSeq: Sequence,
  records: z.array(ModelAdmissionHistoryRecord).max(100),
  nextAfterSeq: Sequence.nullable(),
}).strict().superRefine((page, context) => {
  const ids = new Set<string>();
  let previous = 0;
  for (const record of page.records) {
    if (record.modelId !== page.modelId || record.seq <= previous || record.seq > page.snapshotSeq || ids.has(record.recordId)) {
      context.addIssue({ code: "custom", message: "history must contain unique ordered records for the requested model within the fence" });
    }
    previous = record.seq;
    ids.add(record.recordId);
  }
  if (page.nextAfterSeq !== null && (page.records.length === 0 || page.nextAfterSeq !== previous || previous >= page.snapshotSeq)) {
    context.addIssue({ code: "custom", message: "continuation must follow a nonempty page below the fence" });
  }
});
export const operations = {
  listModelAdmissionTests: {
    method: "GET", path: "/models/:modelId/admission-tests", in: Input, out: Output,
    err: ["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "INVALID_INPUT"] as const,
  },
} as const;
/** The adapter obtains this model's actual MAX(seq), or zero when empty, in the
 * authorized organization. Append-only rows cannot disappear between pages. */
export const modelAdmissionHistoryExchange = z.object({ request: Input, response: Output }).strict()
  .refine(({ request, response }) => request.modelId === response.modelId &&
    (request.snapshotSeq === null || request.snapshotSeq === response.snapshotSeq) &&
    response.records.length <= request.limit && response.records.every(record => record.seq > request.afterSeq) &&
    (response.nextAfterSeq === null
      ? (response.records.at(-1)?.seq ?? request.afterSeq) === response.snapshotSeq
      : response.records.length === request.limit),
  "history page must preserve the model, sequence fence, offset and page size");
