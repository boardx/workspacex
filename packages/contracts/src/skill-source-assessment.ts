/** Review-only source compatibility/adaptation boundary; no production routes are exported. */
import { z } from "zod";
import { SkillDraft, SkillImportPreview, SkillImportRequestSource, SkillManifestEntry, SkillSourcePin } from "./skill-development";

const Id = z.string().trim().min(1).max(200);
const Digest = SkillManifestEntry.shape.digest;
const Path = SkillManifestEntry.shape.path;
const Base = z.object({ assessmentId: Id, assessmentDigest: Digest, pin: SkillSourcePin, expiresAt: z.string().datetime({ offset: true }) }).strict();
const SourceFiles = z.array(SkillManifestEntry).min(1).max(1000).refine(files => new Set(files.map(file => file.path)).size === files.length, "duplicate source file path");
export const SourceCompatibility = z.enum(["compatible", "needs-adaptation", "unsupported"]);
const SourceInventory = z.object({
  files: SourceFiles,
  license: z.object({ expression: z.string().trim().min(1).max(200).nullable(), path: Path.nullable() }).strict(),
  dependencies: z.array(z.string().trim().min(1).max(1000)).max(100),
  scriptPaths: z.array(Path).max(100),
}).strict().superRefine((inventory, context) => {
  const paths = new Set(inventory.files.map(file => file.path));
  if ((inventory.license.path && !paths.has(inventory.license.path)) || inventory.scriptPaths.some(path => !paths.has(path))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "inventory evidence must refer to captured source files" });
  }
});
export const SkillSourceAssessment = z.discriminatedUnion("compatibility", [
  Base.extend({ compatibility: z.literal("compatible"), preview: SkillImportPreview }).strict(),
  Base.extend({ compatibility: z.literal("needs-adaptation"), inventory: SourceInventory,
    missingRequirements: z.array(z.string().trim().min(1).max(1000)).min(1).max(100) }).strict(),
  Base.extend({ compatibility: z.literal("unsupported"), reasons: z.array(z.string().trim().min(1).max(1000)).min(1).max(100) }).strict(),
]).superRefine((assessment, context) => {
  if (assessment.compatibility === "compatible" && JSON.stringify(assessment.pin) !== JSON.stringify(assessment.preview.pin)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "compatible preview must preserve assessed source pin" });
  }
});

export const SkillAdaptationResult = z.object({ assessmentId: Id, assessmentDigest: Digest, draft: SkillDraft,
  attachments: z.array(z.object({ sourcePath: Path, draftPath: Path.refine(path => path.startsWith("references/imported/"), "source files are inert references"), digest: Digest }).strict()).min(1).max(1000),
  remainingWork: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
}).strict().superRefine((result, context) => {
  if (result.draft.manifestPath !== "SKILL.md" || result.draft.revision !== 1 || result.draft.sourcePin === null || result.draft.basedOnPublishedVersionId !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "adaptation creates a new source-pinned draft, never a published or inherited version" });
  const paths = new Set<string>();
  const sources = new Set<string>();
  for (const attachment of result.attachments) {
    if (sources.has(attachment.sourcePath) || paths.has(attachment.draftPath) || !result.draft.files.some(file => file.path === attachment.draftPath && file.digest === attachment.digest)) context.addIssue({ code: z.ZodIssueCode.custom, message: "attachment must identify a unique draft reference file with matching digest" });
    paths.add(attachment.draftPath); sources.add(attachment.sourcePath);
  }
  if (result.draft.files.some(file => file.path !== "SKILL.md" && !paths.has(file.path))) context.addIssue({ code: z.ZodIssueCode.custom, message: "adaptation output contains unreviewed files" });
});
export const SourceAssessmentError = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "SOURCE_CONNECTION_REQUIRED", "SOURCE_CONNECTION_UNAVAILABLE", "SOURCE_ACCESS_DENIED", "SOURCE_RATE_LIMITED", "SOURCE_MOVED", "ASSESSMENT_EXPIRED", "ASSESSMENT_NOT_ADAPTABLE", "VALIDATION_ERROR", "IDEMPOTENCY_CONFLICT", "DEPENDENCY_UNAVAILABLE"]);
export const operations = {
  assessSkillImportSource: { method: "POST", path: "/admin/skill-development/source-assessments", in: z.object({ source: SkillImportRequestSource }).strict(), out: SkillSourceAssessment, err: SourceAssessmentError.options },
  getSkillSourceAssessment: { method: "GET", path: "/admin/skill-development/source-assessments/:assessmentId", in: z.object({ assessmentId: Id }).strict(), out: SkillSourceAssessment, err: SourceAssessmentError.options },
  createSkillAdaptationDraft: { method: "POST", path: "/admin/skill-development/adaptation-drafts", in: z.object({ assessmentId: Id, expectedAssessmentDigest: Digest, name: z.string().trim().min(1).max(200), selectedPaths: z.array(Path).min(1).max(1000).refine(paths => new Set(paths).size === paths.length, "duplicate selected path"), idempotencyKey: z.string().trim().min(8).max(200) }).strict(), out: SkillAdaptationResult, err: SourceAssessmentError.options },
} as const;

/** Server adapter loads the assessment under actor/tenant authorization before validating this exchange. */
export const skillAdaptationExchange = z.object({ assessment: SkillSourceAssessment, request: operations.createSkillAdaptationDraft.in, response: SkillAdaptationResult }).strict()
  .refine(({ assessment, request, response }) => assessment.compatibility === "needs-adaptation" &&
    assessment.assessmentId === request.assessmentId && response.assessmentId === request.assessmentId &&
    assessment.assessmentDigest === request.expectedAssessmentDigest && response.assessmentDigest === request.expectedAssessmentDigest &&
    JSON.stringify(assessment.pin) === JSON.stringify(response.draft.sourcePin) &&
    request.selectedPaths.every(path => assessment.inventory.files.some(file => file.path === path)) &&
    request.selectedPaths.every(path => response.attachments.some(file => file.sourcePath === path)) &&
    response.attachments.every(file => (request.selectedPaths.includes(file.sourcePath) || assessment.inventory.license.path === file.sourcePath) && assessment.inventory.files.some(source => source.path === file.sourcePath && source.digest === file.digest)),
    "adaptation must preserve selected files from the authorized exact source assessment");
