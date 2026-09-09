/** #3249: authenticated editing of one complete immutable Skill version. */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { operations, SkillFileSnapshot, SkillFileEditError as ErrorCode } from "@repo/contracts/skill-file-edit";
import { TrustedSkillPackage } from "@repo/contracts/standard-capabilities";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
export type SkillFileSnapshotValue = z.infer<typeof SkillFileSnapshot>;
export type SaveSkillFilesInput = z.infer<typeof operations.saveSkillFiles.in>;
type Context = { orgId: string; actorId: string };
export class SkillFileEditError extends Error {
  constructor(readonly code: z.infer<typeof ErrorCode>, readonly currentVersionId?: string) { super(code); this.name = "SkillFileEditError"; }
}
export interface SkillFileEditRepository {
  read(input: Context & z.infer<typeof operations.getSkillFileSnapshot.in>): Promise<SkillFileSnapshotValue | null>;
  append(input: Context & { skillId: string; expectedVersionId: string; files: SkillFileSnapshotValue["files"]; contentDigest: string }): Promise<
    { kind: "ok"; snapshot: SkillFileSnapshotValue } | { kind: "not-found" } | { kind: "conflict"; currentVersionId: string }>;
}
export const SKILL_FILE_EDIT_REPOSITORY = Symbol("SkillFileEditRepository");
export interface SkillFileEditDeps { identities: Pick<IdentityRepository, "findOrgMembership">; repository: SkillFileEditRepository }
async function authorize(input: Context, deps: SkillFileEditDeps) {
  const member = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!member || member.orgRole !== "admin") throw new SkillFileEditError("EDIT_NOT_ORG_ADMIN");
}
export async function getSkillFileSnapshot(input: Context & z.infer<typeof operations.getSkillFileSnapshot.in>, deps: SkillFileEditDeps) {
  await authorize(input, deps);
  const result = await deps.repository.read(input);
  if (!result) throw new SkillFileEditError("EDIT_SKILL_NOT_FOUND");
  return result;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function saveSkillFiles(input: Context & SaveSkillFilesInput, deps: SkillFileEditDeps): Promise<SkillFileSnapshotValue> {
  await authorize(input, deps);
  if (!operations.saveSkillFiles.in.safeParse({ skillId: input.skillId, expectedVersionId: input.expectedVersionId, mutations: input.mutations }).success) {
    throw new SkillFileEditError("EDIT_CONTENT_INVALID");
  }
  const before = await deps.repository.read({ ...input, versionId: input.expectedVersionId });
  if (!before) throw new SkillFileEditError("EDIT_SKILL_NOT_FOUND");
  if (before.readOnly) throw new SkillFileEditError("EDIT_READ_ONLY");
  const files = new Map(before.files.map(file => [file.path, file]));
  for (const mutation of input.mutations) {
    if (mutation.kind === "put") {
      const bytes = Buffer.from(mutation.contentBase64, "base64");
      files.set(mutation.path, { path: mutation.path, contentBase64: mutation.contentBase64, mediaType: mutation.mediaType, digest: hash(bytes), sizeBytes: bytes.length });
    } else if (mutation.kind === "delete") {
      if (!files.delete(mutation.path)) throw new SkillFileEditError("EDIT_CONTENT_INVALID");
    } else {
      const file = files.get(mutation.from);
      if (!file || files.has(mutation.to)) throw new SkillFileEditError("EDIT_CONTENT_INVALID");
      files.delete(mutation.from); files.set(mutation.to, { ...file, path: mutation.to });
    }
  }
  const next = [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  // Reuse runtime bounds/paths/base64; unchanged binary content is never UTF-8 roundtripped.
  const packageResult = TrustedSkillPackage.safeParse({ skillId: input.skillId, versionId: input.expectedVersionId,
    files: next.map(({ sizeBytes: _sizeBytes, ...file }) => file) });
  if (!packageResult.success || next.some(file => file.path.split("/").slice(0, -1).some((_, i, parts) => files.has(parts.slice(0, i + 1).join("/"))))) {
    throw new SkillFileEditError("EDIT_CONTENT_INVALID");
  }
  // Preserve the existing admin version-edit rule: nonempty UTF-8 SKILL.md, without
  // imposing asset-governance's separate required frontmatter on imported packages.
  try {
    const root = files.get("SKILL.md")!;
    if (!new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(root.contentBase64, "base64")).trim()) throw new Error("empty root");
  } catch { throw new SkillFileEditError("EDIT_CONTENT_INVALID"); }
  const contentDigest = hash(Buffer.from(next.map(file => `${file.path}\0${file.digest}`).join("\n"), "utf8"));
  const result = await deps.repository.append({ orgId: input.orgId, actorId: input.actorId, skillId: input.skillId,
    expectedVersionId: input.expectedVersionId, files: next, contentDigest });
  if (result.kind === "not-found") throw new SkillFileEditError("EDIT_SKILL_NOT_FOUND");
  if (result.kind === "conflict") throw new SkillFileEditError("EDIT_VERSION_CONFLICT", result.currentVersionId);
  return result.snapshot;
}
