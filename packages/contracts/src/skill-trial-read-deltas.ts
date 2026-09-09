/** Review-only delta for the existing published-version trial read, not draft trials.
 * Preserve actor-scoped 404 before reading input, stderr or artifacts. No new route. */
import { z } from "zod";
import { operations as existing, TrialRun } from "./skills";
import { PublicSkillTrialRun, StoredSkillTrialArtifacts, projectSkillTrialArtifact } from "./skill-trial-artifact-download";

const Subject = TrialRun.pick({ trialRunId: true, versionId: true, input: true }).extend({ artifacts: StoredSkillTrialArtifacts }).strict();
const Result = existing.getTrialRun.out.extend({
  trialRun: PublicSkillTrialRun.nullable(),
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
  response.trialRunId === stored.trialRunId && response.versionId === stored.versionId && response.input === stored.input &&
  (response.trialRun === null || response.trialRun.artifacts.length === stored.artifacts.length &&
    response.trialRun.artifacts.every((artifact, index) => {
      const expected = projectSkillTrialArtifact(stored.artifacts[index]!);
      return artifact.availability === expected.availability && artifact.name === expected.name &&
        artifact.mime === expected.mime && artifact.sizeBytes === expected.sizeBytes &&
        (artifact.availability === "downloadable" && expected.availability === "downloadable"
          ? artifact.artifactId === expected.artifactId && artifact.sha256 === expected.sha256
          : artifact.availability === "unavailable" && expected.availability === "unavailable" && artifact.reason === expected.reason);
    })),
"all lifecycle states retain the authorized stored version and original input");
