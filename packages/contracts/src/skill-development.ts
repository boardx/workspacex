/**
 * Review-only contract draft for Skill import and version development.
 *
 * This file is intentionally not exported from `src/index.ts` and does not alter the frozen
 * `POST /skills` route. Preview fixtures may validate against it; production adoption requires UC/API sign-off.
 */
import { z } from "zod";
import { McpRunSnapshotRef } from "./mcp-runtime-snapshot";
import { AgentRunError } from "./wave2-runtime";
import { CapabilityModelConfigRef, CapabilityTrialRunDependencySnapshot } from "./capability-runtime-policy";

const Id = z.string().trim().min(1).max(200);
const Revision = z.number().int().positive();
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const GitCommit = z.string().regex(/^[a-f0-9]{40}$/);
const IdempotencyKey = z.string().trim().min(8).max(200);
const IsoDateTime = z.string().datetime({ offset: true });
const RelativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(path => !path.startsWith("/") && !path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== ".."), "canonical relative path required");
const Base64 = z.string().max(8_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const GithubRequest = z.object({
  kind: z.literal("github"),
  repositoryUrl: z.string().url().regex(/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/?$/),
  selection: z.enum(["repository-root", "subdirectory", "single-file"]),
  path: RelativePath.nullable(),
  requestedRef: z.string().trim().min(1).max(255),
  authConnectionId: Id.nullable(),
}).strict();
const ZipRequest = z.object({ kind: z.literal("zip"), uploadId: Id }).strict();
const HttpsRequest = z.object({
  kind: z.literal("https-file"), url: z.string().url().regex(/^https:\/\//), authConnectionId: Id.nullable(),
}).strict();
const coherentSelection = (source: { kind: string; selection?: string; path?: string | null }, context: z.RefinementCtx) => {
  if (source.kind === "github" && ((source.selection === "repository-root") !== (source.path === null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: "root requires null path; selected source requires path" });
  }
};
/** Client intent. Source identities and digests are resolved by the server, never supplied as proof. */
export const SkillImportRequestSource = z.discriminatedUnion("kind", [GithubRequest, ZipRequest, HttpsRequest])
  .superRefine(coherentSelection);
/** Server response describing the exact fetched content. */
export const SkillImportSource = z.discriminatedUnion("kind", [
  GithubRequest.extend({ resolvedCommit: GitCommit }).strict(),
  ZipRequest.extend({ archiveDigest: Sha256 }).strict(),
  HttpsRequest.extend({ contentDigest: Sha256 }).strict(),
]).superRefine(coherentSelection);
export type SkillImportSource = z.infer<typeof SkillImportSource>;

export const SkillSourcePin = z
  .object({
    source: SkillImportSource,
    /** Digest of the normalized source tree, not a mutable branch name or URL response alone. */
    sourceDigest: Sha256,
  })
  .strict();

export const SkillManifestEntry = z
  .object({ path: RelativePath, digest: Sha256, sizeBytes: z.number().int().nonnegative() })
  .strict();
const SkillManifestFiles = z
  .array(SkillManifestEntry)
  .min(1)
  .max(1000)
  .superRefine((files, context) => {
    const seen = new Set<string>();
    files.forEach((file, index) => {
      if (seen.has(file.path)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "path"], message: "file path must be unique" });
      }
      seen.add(file.path);
    });
  });

const requireManifestFile = (
  value: { manifestPath: string; files: ReadonlyArray<{ path: string }> },
  context: z.RefinementCtx,
) => {
  if (!value.files.some((file) => file.path === value.manifestPath)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifestPath"], message: "manifest must exist in files" });
  }
};

export const SkillImportCandidate = z.object({
  candidateId: Id,
  name: z.string().trim().min(1).max(200),
  manifestPath: RelativePath,
  files: SkillManifestFiles,
  warnings: z.array(z.string().min(1).max(1000)).max(100),
}).strict().superRefine(requireManifestFile);

export const SkillImportPreview = z.object({
  previewId: Id,
  pin: SkillSourcePin,
  previewDigest: Sha256,
  candidates: z.array(SkillImportCandidate).min(1).max(100),
  expiresAt: IsoDateTime,
}).strict().refine(value => new Set(value.candidates.map(candidate => candidate.candidateId)).size === value.candidates.length,
  { path: ["candidates"], message: "candidate IDs must be unique" });

export const SkillDraft = z
  .object({
    skillId: Id,
    draftId: Id,
    revision: Revision,
    snapshotDigest: Sha256,
    manifestPath: RelativePath,
    files: SkillManifestFiles,
    sourcePin: SkillSourcePin.nullable(),
    basedOnPublishedVersionId: Id.nullable(),
    updatedAt: IsoDateTime,
  })
  .strict()
  .superRefine(requireManifestFile);

export const PublishedSkillVersion = z
  .object({
    skillId: Id,
    versionId: Id,
    versionNumber: z.number().int().positive(),
    draftId: Id,
    draftRevision: Revision,
    snapshotDigest: Sha256,
    manifestPath: RelativePath,
    publishedAt: IsoDateTime,
  })
  .strict();

export const ImportFailureCode = z.enum([
  "DEPENDENCY_UNAVAILABLE", "SOURCE_MOVED", "PREVIEW_EXPIRED", "VALIDATION_FAILED",
  "IMPORT_LIMIT_EXCEEDED", "PERMISSION_REVOKED", "CREDENTIAL_UNAVAILABLE", "REVISION_CONFLICT",
]);
const ImportFailure = z.object({ code: ImportFailureCode, message: z.string().min(1).max(2000), retryable: z.boolean() }).strict();
const TrialFailure = ImportFailure.extend({ code: z.union([AgentRunError, z.enum([
  "DEPENDENCY_UNAVAILABLE", "PERMISSION_REVOKED", "MODEL_UNAVAILABLE", "MCP_SNAPSHOT_UNAVAILABLE", "VALIDATION_FAILED",
])]) }).strict();
const JobBase = { jobId: Id, submittedAt: IsoDateTime, idempotencyKey: IdempotencyKey } as const;

const ImportJobBase = {
  ...JobBase, candidateId: Id, previewId: Id, sourceDigest: Sha256,
  attempt: z.number().int().positive(), previousAttemptJobId: Id.nullable(),
};
export const ImportJob = z.discriminatedUnion("status", [
  z.object({ ...ImportJobBase, status: z.literal("queued") }).strict(),
  z.object({ ...ImportJobBase, status: z.literal("running"), startedAt: IsoDateTime }).strict(),
  z.object({ ...ImportJobBase, status: z.literal("succeeded"), completedAt: IsoDateTime, result: SkillDraft }).strict(),
  z.object({ ...ImportJobBase, status: z.literal("failed"), completedAt: IsoDateTime, failure: ImportFailure }).strict(),
  z.object({ ...ImportJobBase, status: z.literal("cancelled"), completedAt: IsoDateTime }).strict(),
 ]).superRefine((job, context) => {
  if (job.status === "succeeded" && (!job.result.sourcePin || job.result.sourcePin.sourceDigest !== job.sourceDigest)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["result", "sourcePin"], message: "imported draft must retain the job source digest" });
  }
  if ((job.attempt === 1) !== (job.previousAttemptJobId === null) || job.previousAttemptJobId === job.jobId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousAttemptJobId"], message: "first attempt has no predecessor; retries require a distinct predecessor" });
  }
});
/** Each candidate has one current attempt; successful items survive sibling failure/cancellation. */
export const ImportBatch = z.object({
  batchId: Id,
  previewId: Id,
  items: z.array(ImportJob).min(1).max(100),
}).strict().superRefine((batch, context) => {
  const candidates = new Set<string>();
  const jobs = new Set<string>();
  batch.items.forEach((item, index) => {
    if (item.previewId !== batch.previewId || item.sourceDigest !== batch.items[0]?.sourceDigest || candidates.has(item.candidateId) || jobs.has(item.jobId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "batch items require the same preview and unique candidate IDs" });
    }
    candidates.add(item.candidateId);
    jobs.add(item.jobId);
  });
});
export function summarizeImportBatch(batch: z.infer<typeof ImportBatch>) {
  const statuses = batch.items.map(item => item.status);
  if (statuses.every(status => status === "queued")) return "queued";
  if (statuses.some(status => status === "queued" || status === "running")) return "running";
  if (statuses.every(status => status === "succeeded")) return "succeeded";
  if (statuses.every(status => status === "failed")) return "failed";
  if (statuses.every(status => status === "cancelled")) return "cancelled";
  return "partial";
}

export const TrialModelSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("configured") }).strict(),
  z.object({ mode: z.literal("explicit"), modelConfigRef: CapabilityModelConfigRef }).strict(),
]);

export const FrozenTrialDependencies = CapabilityTrialRunDependencySnapshot;

export const TrialEvidence = z
  .object({
    trialRunId: Id,
    draftRevision: Revision,
    snapshotDigest: Sha256,
    dependencySnapshot: FrozenTrialDependencies,
    passedAt: IsoDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    const subject = value.dependencySnapshot.subject;
    if (subject.kind !== "skill-draft" || subject.draftRevision !== value.draftRevision || subject.snapshotDigest !== value.snapshotDigest) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dependencySnapshot", "subject"], message: "trial evidence must identify the same skill draft snapshot" });
    }
  });

export const PublicationResult = z.object({ published: PublishedSkillVersion, archivedVersionId: Id.nullable(), evidence: TrialEvidence }).strict()
  .superRefine((result, context) => {
    const subject = result.evidence.dependencySnapshot.subject;
    if (subject.kind !== "skill-draft" || subject.skillId !== result.published.skillId || subject.draftId !== result.published.draftId ||
      subject.draftRevision !== result.published.draftRevision || subject.snapshotDigest !== result.published.snapshotDigest) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["published"], message: "publication must match the tested draft identity and snapshot" });
    }
  });
export const RestoredDraftResult = z.object({ draft: SkillDraft, restoredFrom: z.object({ versionId: Id, snapshotDigest: Sha256 }).strict() }).strict()
  .refine(result => result.draft.basedOnPublishedVersionId === result.restoredFrom.versionId && result.draft.snapshotDigest === result.restoredFrom.snapshotDigest,
    { path: ["restoredFrom"], message: "restored draft must retain the historical version lineage and content" });

export const TrialJob = z.discriminatedUnion("status", [
  z.object({ ...JobBase, status: z.literal("queued") }).strict(),
  z.object({ ...JobBase, status: z.literal("running"), startedAt: IsoDateTime }).strict(),
  z.object({ ...JobBase, status: z.literal("succeeded"), completedAt: IsoDateTime, evidence: TrialEvidence }).strict(),
  z.object({ ...JobBase, status: z.literal("failed"), completedAt: IsoDateTime, failure: TrialFailure }).strict(),
  z.object({ ...JobBase, status: z.literal("cancelled"), completedAt: IsoDateTime }).strict(),
]);

const SimpleError = <Code extends string>(code: Code, retryable: boolean) =>
  z.object({ code: z.literal(code), message: z.string().min(1).max(2000), retryable: z.literal(retryable) }).strict();
const ValidationError = z
  .object({
    code: z.literal("VALIDATION_FAILED"),
    message: z.string().min(1).max(2000),
    retryable: z.literal(false),
    issues: z.array(z.object({ path: z.string(), message: z.string().min(1) }).strict()).min(1),
  })
  .strict();
const RevisionConflict = z
  .object({
    code: z.literal("REVISION_CONFLICT"),
    message: z.string().min(1).max(2000),
    retryable: z.literal(false),
    currentRevision: Revision,
    currentSnapshotDigest: Sha256,
  })
  .strict();
const IdempotencyConflict = z
  .object({
    code: z.literal("IDEMPOTENCY_CONFLICT"),
    message: z.string().min(1).max(2000),
    retryable: z.literal(false),
    originalRequestDigest: Sha256,
    existingJobId: Id.nullable(),
  })
  .strict();
const DependencyUnavailable = z
  .object({
    code: z.literal("DEPENDENCY_UNAVAILABLE"),
    message: z.string().min(1).max(2000),
    retryable: z.literal(true),
    retryAfterMs: z.number().int().positive().nullable(),
  })
  .strict();
const Unauthenticated = SimpleError("UNAUTHENTICATED", false);
const PermissionDenied = SimpleError("PERMISSION_REVOKED", false);
const NotFound = SimpleError("NOT_FOUND", false);
const PreviewExpired = SimpleError("PREVIEW_EXPIRED", false);
const JobNotRetryable = SimpleError("JOB_NOT_RETRYABLE", false);
const SourceMoved = SimpleError("SOURCE_MOVED", false);
const TrialRequired = SimpleError("TRIAL_EVIDENCE_REQUIRED", false);
const TrialMismatch = SimpleError("TRIAL_EVIDENCE_MISMATCH", false);
const UpstreamConflict = SimpleError("UPSTREAM_CONFLICT", false);
const ModelUnavailable = SimpleError("MODEL_UNAVAILABLE", false);
const McpUnavailable = SimpleError("MCP_SNAPSHOT_UNAVAILABLE", false);

const DraftMutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("put"), path: RelativePath, contentBase64: Base64 }).strict(),
  z.object({ kind: z.literal("delete"), path: RelativePath }).strict(),
  z.object({ kind: z.literal("rename"), from: RelativePath, to: RelativePath }).strict(),
]);

const ExactDraft = z.object({ skillId: Id, draftId: Id, expectedRevision: Revision, expectedSnapshotDigest: Sha256 });
/** The server loads this run within the caller's scope and compares all frozen dependencies. */
const PublishInput = ExactDraft.extend({ idempotencyKey: IdempotencyKey, trialRunId: Id }).strict();

/** Restore files to an existing draft under CAS; publication always follows the normal trial gate. */
const RollbackInput = ExactDraft.extend({
  targetVersionId: Id,
  targetSnapshotDigest: Sha256,
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: IdempotencyKey,
}).strict();

export const UpstreamStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unchanged"), checkedPin: SkillSourcePin }).strict(),
  z.object({ state: z.literal("fast-forward"), checkedPin: SkillSourcePin, changedPaths: z.array(RelativePath).min(1) }).strict(),
  z
    .object({
      state: z.literal("conflicted"),
      checkedPin: SkillSourcePin,
      conflicts: z.array(z.object({ path: RelativePath, baseDigest: Sha256.nullable(), localDigest: Sha256.nullable(), upstreamDigest: Sha256.nullable() }).strict()).min(1),
    })
    .strict(),
]);

/** Derive the repository error-code list from the response schemas. */
function defineOperation<const Definition extends { errors: { options: readonly { shape: { code: { value: string } } }[] } }>(definition: Definition) {
  return { ...definition, err: definition.errors.options.map(error => error.shape.code.value) };
}

export const operations = {
  createImportPreview: defineOperation({
    method: "POST",
    path: "/admin/skill-development/import-previews",
    in: z.object({ source: SkillImportRequestSource, manifestPath: RelativePath.nullable() }).strict(),
    out: SkillImportPreview,
    errors: z.union([Unauthenticated, PermissionDenied, ValidationError, DependencyUnavailable, SourceMoved]),
  }),
  getImportPreview: defineOperation({
    method: "GET",
    path: "/admin/skill-development/import-previews/:previewId",
    in: z.object({ previewId: Id }).strict(),
    out: SkillImportPreview,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, PreviewExpired, DependencyUnavailable]),
  }),
  confirmImport: defineOperation({
    method: "POST",
    path: "/admin/skill-development/import-batches",
    in: z.object({ previewId: Id, expectedPreviewDigest: Sha256,
      candidateIds: z.array(Id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "candidate IDs must be unique"),
      idempotencyKey: IdempotencyKey }).strict(),
    out: ImportBatch,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, PreviewExpired, SourceMoved, IdempotencyConflict, DependencyUnavailable]),
  }),
  getImportBatch: defineOperation({
    method: "GET",
    path: "/admin/skill-development/import-batches/:batchId",
    in: z.object({ batchId: Id }).strict(),
    out: ImportBatch,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  cancelImportJob: defineOperation({
    method: "POST",
    path: "/admin/skill-development/import-jobs/:jobId/cancellations",
    in: z.object({ jobId: Id, idempotencyKey: IdempotencyKey }).strict(),
    out: ImportJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, IdempotencyConflict, DependencyUnavailable]),
  }),
  getImportJob: defineOperation({
    method: "GET",
    path: "/admin/skill-development/import-jobs/:jobId",
    in: z.object({ jobId: Id }).strict(),
    out: ImportJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  retryImportJob: defineOperation({
    method: "POST",
    path: "/admin/skill-development/import-jobs/:jobId/retries",
    in: z.object({ jobId: Id, idempotencyKey: IdempotencyKey }).strict(),
    out: ImportJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, JobNotRetryable, IdempotencyConflict, DependencyUnavailable]),
  }),
  getSkillDraft: defineOperation({
    method: "GET",
    path: "/admin/skill-development/skills/:skillId/draft",
    in: z.object({ skillId: Id }).strict(),
    out: SkillDraft,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  getSkillDraftFile: defineOperation({
    method: "GET",
    path: "/admin/skill-development/skills/:skillId/draft/files",
    in: ExactDraft.extend({ path: RelativePath }).strict(),
    out: z.object({ revision: Revision, snapshotDigest: Sha256, path: RelativePath, contentBase64: Base64 }).strict(),
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, DependencyUnavailable]),
  }),
  importIntoSkillDraft: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/draft/imports",
    in: ExactDraft.extend({ previewId: Id, candidateId: Id, expectedPreviewDigest: Sha256, idempotencyKey: IdempotencyKey }).strict(),
    out: ImportJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, PreviewExpired, SourceMoved, IdempotencyConflict, DependencyUnavailable]),
  }),
  mutateSkillDraft: defineOperation({
    method: "PATCH",
    path: "/admin/skill-development/skills/:skillId/draft",
    in: ExactDraft.extend({ mutations: z.array(DraftMutation).min(1).max(1000), idempotencyKey: IdempotencyKey }).strict(),
    out: SkillDraft,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, IdempotencyConflict, ValidationError, DependencyUnavailable]),
  }),
  runSkillDraftTrial: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/draft-trial-jobs",
    in: ExactDraft.extend({
      sampleInput: z.string().min(1).max(100_000),
      model: TrialModelSelection,
      mcpSnapshot: McpRunSnapshotRef.nullable(),
      idempotencyKey: IdempotencyKey,
    }).strict(),
    out: TrialJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, IdempotencyConflict, ModelUnavailable, McpUnavailable, DependencyUnavailable]),
  }),
  getSkillDraftTrialJob: defineOperation({
    method: "GET",
    path: "/admin/skill-development/draft-trial-jobs/:jobId",
    in: z.object({ jobId: Id }).strict(),
    out: TrialJob,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  publishSkillDraft: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/publications",
    in: PublishInput,
    out: PublicationResult,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, TrialRequired, TrialMismatch, IdempotencyConflict, DependencyUnavailable]),
  }),
  checkSkillUpstream: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/upstream-checks",
    in: ExactDraft.strict(),
    out: UpstreamStatus,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, SourceMoved, DependencyUnavailable]),
  }),
  mergeSkillUpstream: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/upstream-merges",
    in: ExactDraft.extend({
      checkedSourceDigest: Sha256,
      resolutions: z.array(z.discriminatedUnion("choice", [
        z.object({ path: RelativePath, choice: z.literal("local") }).strict(),
        z.object({ path: RelativePath, choice: z.literal("upstream") }).strict(),
        z.object({ path: RelativePath, choice: z.literal("delete") }).strict(),
        z.object({ path: RelativePath, choice: z.literal("manual"), contentBase64: Base64 }).strict(),
      ])).max(1000),
      idempotencyKey: IdempotencyKey,
    }).strict(),
    out: SkillDraft,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, SourceMoved, UpstreamConflict, IdempotencyConflict, DependencyUnavailable]),
  }),
  listSkillVersions: defineOperation({
    method: "GET",
    path: "/admin/skill-development/skills/:skillId/versions",
    in: z.object({ skillId: Id, cursor: Id.nullable(), limit: z.number().int().min(1).max(100) }).strict(),
    out: z.object({ versions: z.array(PublishedSkillVersion).max(100), nextCursor: Id.nullable() }).strict(),
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  getSkillVersion: defineOperation({
    method: "GET",
    path: "/admin/skill-development/skills/:skillId/versions/:versionId",
    in: z.object({ skillId: Id, versionId: Id }).strict(),
    out: z.object({ version: PublishedSkillVersion, files: SkillManifestFiles }).strict()
      .superRefine((result, context) => requireManifestFile({ manifestPath: result.version.manifestPath, files: result.files }, context)),
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, DependencyUnavailable]),
  }),
  rollbackSkillVersion: defineOperation({
    method: "POST",
    path: "/admin/skill-development/skills/:skillId/rollbacks",
    in: RollbackInput,
    out: RestoredDraftResult,
    errors: z.union([Unauthenticated, PermissionDenied, NotFound, RevisionConflict, IdempotencyConflict, DependencyUnavailable]),
  }),
} as const;
