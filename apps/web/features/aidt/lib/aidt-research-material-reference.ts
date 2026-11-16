import { z } from "zod";

export const AidtResearchMaterialIdentifier = z.string().min(1).max(256).refine(value => value !== "." && value !== ".." && !/[\u0000-\u001f\u007f]/u.test(value));
/** Persisted reference structure only. This is not an authorization or upload receipt. */
export const AidtResearchMaterial = z.object({ projectId: AidtResearchMaterialIdentifier, runId: AidtResearchMaterialIdentifier, artifactId: AidtResearchMaterialIdentifier, versionId: AidtResearchMaterialIdentifier, name: z.string().min(1).max(300), mime: z.string().min(1).max(150), sha256: z.string().regex(/^[a-f0-9]{64}$/u), bytes: z.number().int().nonnegative(), submittedBy: AidtResearchMaterialIdentifier.optional(), submittedAt: z.string().datetime().optional() }).strict().refine(value => Boolean(value.submittedBy) === Boolean(value.submittedAt), "Upload submitter and time must be paired");
export type AidtResearchMaterialReference = z.infer<typeof AidtResearchMaterial>;
export const researchMaterialKey = (kind: "idea" | "source" | "photo", id: string) => `${kind === "idea" ? "ideaFile" : kind === "photo" ? "discoveryPhoto" : "discoveryFile"}:${id}`;
export function parseAidtResearchMaterial(raw?: string): AidtResearchMaterialReference | null {
  if (!raw || raw.length > 6000) return null;
  try { const result = AidtResearchMaterial.safeParse(JSON.parse(raw)); return result.success ? result.data : null; } catch { return null; }
}
export function aidtResearchMaterialLabel(reference: AidtResearchMaterialReference): string { return `${reference.name} · 原件 ${reference.artifactId} · 版本 ${reference.versionId} · 上传回执 ${reference.runId}`; }
export const isAidtResearchImage = (reference: AidtResearchMaterialReference) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(reference.mime);
export function aidtResearchMaterialsFromFields(fields: Readonly<Record<string, string>>, projectId?: string) {
  return Object.entries(fields).flatMap(([key, value]) => { const material = /^(researchFile|ideaFile|discoveryPhoto|discoveryFile):/u.test(key) ? parseAidtResearchMaterial(value) : null; return material && (!projectId || material.projectId === projectId) ? [{ key, material }] : []; });
}
export function aidtResearchContentPath(reference: Pick<AidtResearchMaterialReference, "runId" | "projectId">) {
  return `/ingestion-runs/${encodeURIComponent(AidtResearchMaterialIdentifier.parse(reference.runId))}/content?projectId=${encodeURIComponent(AidtResearchMaterialIdentifier.parse(reference.projectId))}`;
}
