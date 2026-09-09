/** Atomic edits to published model-A Skill snapshots (#3249).
 * Saving appends and publishes one immutable version; existing Agent pins remain fixed.
 * These APIs do not represent a persistent mutable draft or grant execution permissions.
 */
import { z } from "zod";
import { SkillPackagePath, TrustedSkillPackageFile, CanonicalBase64, SKILL_PACKAGE_LIMITS, decodedBase64Size } from "./standard-capabilities";
// Bounded transport budget: base64 package bytes plus worst-case escaped path/media metadata.
export const SKILL_FILE_EDIT_BODY_MAX_BYTES = Math.ceil(SKILL_PACKAGE_LIMITS.maxPackageBytes / 3) * 4 + SKILL_PACKAGE_LIMITS.maxFiles * 8192 + 1024;
const Id = z.string().trim().min(1).max(160);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const File = TrustedSkillPackageFile.innerType().extend({ sizeBytes: z.number().int().nonnegative() }).strict()
  .refine(value => value.sizeBytes <= SKILL_PACKAGE_LIMITS.maxFileBytes && value.sizeBytes === decodedBase64Size(value.contentBase64), "declared size must match bytes");
export const SkillFileSnapshot = z.object({
  skillId: Id, versionId: Id, semanticLabel: z.string().min(1), contentDigest: Digest,
  createdAt: z.string().datetime({ offset: true }), readOnly: z.boolean(),
  files: z.array(File).min(1).max(SKILL_PACKAGE_LIMITS.maxFiles),
}).strict().superRefine((value, ctx) => {
  const paths = new Set(value.files.map(file => file.path));
  if (!paths.has("SKILL.md") || paths.size !== value.files.length) ctx.addIssue({ code: "custom", message: "unique paths and root SKILL.md required" });
  if (value.files.reduce((sum, file) => sum + file.sizeBytes, 0) > SKILL_PACKAGE_LIMITS.maxPackageBytes) ctx.addIssue({ code: "custom", message: "package byte limit exceeded" });
});
// Mutations identify the baseline paths once; chaining/overlapping targets is rejected.
const MutablePath = SkillPackagePath.refine(path => path !== "SKILL.md", "root SKILL.md cannot be removed or renamed");
const Put = z.object({ kind: z.literal("put"), path: SkillPackagePath,
  contentBase64: z.string().max(Math.ceil(SKILL_PACKAGE_LIMITS.maxFileBytes / 3) * 4).pipe(CanonicalBase64),
  mediaType: z.string().min(1).max(255) }).strict()
  .refine(value => decodedBase64Size(value.contentBase64) <= SKILL_PACKAGE_LIMITS.maxFileBytes, "file byte limit exceeded");
export const SkillFileMutation = z.union([Put,
  z.object({ kind: z.literal("delete"), path: MutablePath }).strict(),
  z.object({ kind: z.literal("rename"), from: MutablePath, to: MutablePath }).strict(),
]);
const Save = z.object({ skillId: Id, expectedVersionId: Id,
  mutations: z.array(SkillFileMutation).min(1).max(SKILL_PACKAGE_LIMITS.maxFiles) }).strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    let bytes = 0;
    for (const mutation of value.mutations) {
      for (const path of mutation.kind === "rename" ? [mutation.from, mutation.to] : [mutation.path]) {
        if (seen.has(path)) ctx.addIssue({ code: "custom", message: "each baseline path/target may be touched only once" });
        seen.add(path);
      }
      if (mutation.kind === "put") bytes += decodedBase64Size(mutation.contentBase64);
    }
    if (bytes > SKILL_PACKAGE_LIMITS.maxPackageBytes) ctx.addIssue({ code: "custom", message: "mutation byte limit exceeded" });
  });
export const SkillFileEditError = z.enum(["EDIT_NOT_ORG_ADMIN", "EDIT_SKILL_NOT_FOUND", "EDIT_VERSION_CONFLICT", "EDIT_READ_ONLY", "EDIT_CONTENT_INVALID", "DEPENDENCY_UNAVAILABLE"]);
export const SkillFileEditConflict = z.object({ reasonCode: z.literal("EDIT_VERSION_CONFLICT"), currentVersionId: Id }).strict();
export const operations = {
  getSkillFileSnapshot: { method: "GET", path: "/admin/skills/:skillId/file-snapshot", in: z.object({ skillId: Id, versionId: Id }).strict(), out: SkillFileSnapshot, err: SkillFileEditError.options },
  saveSkillFiles: { method: "POST", path: "/admin/skills/:skillId/file-edits", in: Save, out: SkillFileSnapshot, err: SkillFileEditError.options },
} as const;
