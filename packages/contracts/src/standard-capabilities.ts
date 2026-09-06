/** Standard metadata and trusted package transport, WX-E002 / #2864.
 * Metadata never grants authority. Existing identity / tool policies remain authoritative.
 * Native tool arguments are exported from the installed runtime, not restated here.
 */
import { z } from "zod";

export const StandardCapabilityId = z.string().regex(/^WX-[ETS][0-9]{3}$/);
export const StandardCapabilityDescriptor = z.object({
  id: StandardCapabilityId,
  kind: z.enum(["tool", "skill", "enabler"]),
  canonicalName: z.string().min(1).max(160),
  specVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.object({
    kind: z.enum(["langchain-native", "langchain-integration", "upstream-skill", "workspacex"]),
    locator: z.string().min(1).max(2048),
    // Exact released version or full Git commit, never a moving branch/ref.
    // Registry versions still require the dependency lock's integrity check.
    revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64}|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/),
    license: z.string().min(1).max(160),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const prefix = { tool: "WX-T", skill: "WX-S", enabler: "WX-E" }[value.kind];
  if (!value.id.startsWith(prefix)) ctx.addIssue({ code: "custom", path: ["id"], message: "capability id/kind mismatch" });
});

export const SKILL_PACKAGE_LIMITS = { maxFiles: 256, maxFileBytes: 8 * 1024 * 1024, maxPackageBytes: 16 * 1024 * 1024 } as const;
// One canonical, portable relative path. No aliases, drive paths or control characters.
export const SkillPackagePath = z.string().min(1).max(512).regex(/^(?!\/)(?!.*[\\:\u0000-\u001f\u007f])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$).+$/);
// Avoid quantified four-character groups: V8 can exhaust its regexp stack on
// valid multi-MiB assets. Check padding and unused bits without decoding a copy.
export const CanonicalBase64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).refine((value) => {
  if (value.length % 4 !== 0) return false;
  if (value.endsWith("==")) return /[AQgw]/.test(value.at(-3) ?? "!");
  if (value.endsWith("=")) return /[AEIMQUYcgkosw048]/.test(value.at(-2) ?? "!");
  return true;
}, "canonical base64 padding required");
export function decodedBase64Size(value: string): number {
  return value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}

export const TrustedSkillPackageFile = z.object({
  path: SkillPackagePath,
  contentBase64: z.string().max(Math.ceil(SKILL_PACKAGE_LIMITS.maxFileBytes / 3) * 4).pipe(CanonicalBase64),
  mediaType: z.string().min(1).max(255),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((file, ctx) => {
  if (decodedBase64Size(file.contentBase64) > SKILL_PACKAGE_LIMITS.maxFileBytes) ctx.addIssue({ code: "custom", path: ["contentBase64"], message: "file size limit exceeded" });
});

/** Sent only in trusted run configuration, never in model-visible tool arguments. */
export const TrustedSkillPackage = z.object({
  skillId: z.string().min(1).max(160),
  versionId: z.string().min(1).max(160),
  files: z.array(TrustedSkillPackageFile).min(1).max(SKILL_PACKAGE_LIMITS.maxFiles),
}).strict().superRefine((value, ctx) => {
  const paths = new Set(value.files.map((file) => file.path));
  if (!paths.has("SKILL.md") || paths.size !== value.files.length) ctx.addIssue({ code: "custom", path: ["files"], message: "unique paths and SKILL.md required" });
  if (value.files.reduce((sum, file) => sum + decodedBase64Size(file.contentBase64), 0) > SKILL_PACKAGE_LIMITS.maxPackageBytes) ctx.addIssue({ code: "custom", path: ["files"], message: "package size limit exceeded" });
});

export type TrustedSkillPackageValue = z.infer<typeof TrustedSkillPackage>;
