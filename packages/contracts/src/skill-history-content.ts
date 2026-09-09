/** Proposed immutable content reads for version restore and three-way merge review. */
import { z } from "zod";
import { operations as development, PublishedSkillVersion, SkillManifestEntry } from "./skill-development";
const Path = SkillManifestEntry.shape.path;
const Digest = SkillManifestEntry.shape.digest;
const Content = development.getSkillDraftFile.out.shape.contentBase64;
const VersionRef = PublishedSkillVersion.pick({ skillId: true, versionId: true, snapshotDigest: true }).strict();
const DraftRef = development.getSkillDraftFile.in.omit({ path: true }).strict();
const UpstreamReviewRef = DraftRef.extend({ checkedSourceDigest: Digest }).strict();
export const UpstreamFileSelection = UpstreamReviewRef.extend({ path: Path, expectedFileDigest: Digest.nullable(), side: z.enum(["base", "local", "upstream"]) }).strict();
const FileResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("present"), digest: Digest, contentBase64: Content }).strict(),
  z.object({ kind: z.literal("absent") }).strict(),
]);
export const SkillHistoryContentError = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "REVISION_CONFLICT", "SOURCE_MOVED", "UPSTREAM_CHECK_EXPIRED", "SOURCE_CONNECTION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"]);
const UpstreamEntries = z.array(z.object({ path: Path, baseDigest: Digest.nullable(), localDigest: Digest.nullable(), upstreamDigest: Digest.nullable() }).strict().refine(row => row.baseDigest !== null || row.localDigest !== null || row.upstreamDigest !== null, "at least one side contains the file")).max(3000).refine(rows => new Set(rows.map(row => row.path)).size === rows.length, "duplicate merge file path");
export const operations = {
  listSkillUpstreamFiles: { method: "GET", path: "/admin/skill-development/skills/:skillId/upstream-files/manifest", in: UpstreamReviewRef, out: z.object({ review: UpstreamReviewRef, entries: UpstreamEntries }).strict(), err: SkillHistoryContentError.options },
  getSkillVersionFile: { method: "GET", path: "/admin/skill-development/skills/:skillId/versions/:versionId/files", in: VersionRef.extend({ path: Path, expectedFileDigest: Digest }).strict(), out: z.object({ version: VersionRef, path: Path, digest: Digest, contentBase64: Content }).strict(), err: SkillHistoryContentError.options },
  getSkillUpstreamFile: { method: "GET", path: "/admin/skill-development/skills/:skillId/upstream-files", in: UpstreamFileSelection, out: z.object({ selection: UpstreamFileSelection, file: FileResult }).strict(), err: SkillHistoryContentError.options },
} as const;
export const skillHistoryContentExchanges = {
  listSkillUpstreamFiles: z.object({ request: operations.listSkillUpstreamFiles.in, response: operations.listSkillUpstreamFiles.out }).strict().refine(({ request, response }) => JSON.stringify(request) === JSON.stringify(response.review), "manifest must belong to the exact merge review"),
  getSkillVersionFile: z.object({ request: operations.getSkillVersionFile.in, response: operations.getSkillVersionFile.out }).strict().refine(({ request, response }) => request.skillId === response.version.skillId && request.versionId === response.version.versionId && request.snapshotDigest === response.version.snapshotDigest && request.path === response.path && request.expectedFileDigest === response.digest, "version file must match the requested immutable manifest entry"),
  getSkillUpstreamFile: z.object({ request: operations.getSkillUpstreamFile.in, response: operations.getSkillUpstreamFile.out }).strict().refine(({ request, response }) => JSON.stringify(request) === JSON.stringify(response.selection) && (request.expectedFileDigest === null ? response.file.kind === "absent" : response.file.kind === "present" && response.file.digest === request.expectedFileDigest), "three-way file must identify the exact requested draft, upstream check, path and side"),
} as const;
