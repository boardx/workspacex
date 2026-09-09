/** Review-only delta for the existing published-version trial read, not draft trials.
 * Preserve actor-scoped 404 before reading input, stderr or artifacts. No new route. */
import { z } from "zod";
import { operations as existing, TrialRun } from "./skills";

const Subject = TrialRun.pick({ trialRunId: true, versionId: true, input: true }).strict();
const Result = existing.getTrialRun.out.extend({
  versionId: TrialRun.shape.versionId,
  input: TrialRun.shape.input,
}).strict().superRefine((value, context) => {
  if (value.status === "succeeded") {
    if (!value.trialRun || value.failure !== null || value.trialRun.trialRunId !== value.trialRunId ||
      value.trialRun.versionId !== value.versionId || value.trialRun.input !== value.input) {
      context.addIssue({ code: "custom", message: "successful result must match the immutable trial subject" });
    }
  } else if (value.trialRun !== null || (value.status === "failed" ? value.failure === null : value.failure !== null)) {
    context.addIssue({ code: "custom", message: "only failed trials carry failure and only succeeded trials carry results" });
  }
});
export const operations = {
  getTrialRun: { ...existing.getTrialRun, out: Result },
} as const;
/** Load stored subject from the authorized TrialRunRow, never from request metadata. */
export const skillTrialReadExchange = z.object({
  request: existing.getTrialRun.in,
  stored: Subject,
  response: Result,
}).strict().refine(({ request, stored, response }) => request.trialRunId === stored.trialRunId &&
  response.trialRunId === stored.trialRunId && response.versionId === stored.versionId && response.input === stored.input,
"all lifecycle states retain the authorized stored version and original input");
