import type { z } from "zod";
import { files as C } from "@repo/contracts";
import { apiUrl, ApiError, extractReasonCode } from "@/lib/api-client";
import { listAidtStages, readAidtStage } from "./live-aidt-stages";
import { isAidtModuleEnabled } from "./aidt-module-config";

import { AidtResearchMaterial, AidtResearchMaterialIdentifier as identifier, aidtResearchContentPath, aidtResearchMaterialsFromFields, type AidtResearchMaterialReference } from "./aidt-research-material-reference";
export * from "./aidt-research-material-reference";
export type AidtMaterialReceipt = Omit<AidtResearchMaterialReference, "versionId" | "mime"> & { duplicateAction?: "use-existing" | "as-new-version" };
export type AidtMaterialContext = { projectId: string; sessionToken: string; signal?: AbortSignal };
function assertCurrent(context: AidtMaterialContext) {
  if (!isAidtModuleEnabled() || context.signal?.aborted || !context.sessionToken || !identifier.safeParse(context.projectId).success) throw new Error("AIDT_CONTEXT_CHANGED");
}
async function responseError(response: Response): Promise<never> {
  let body: unknown; try { body = await response.json(); } catch { body = undefined; }
  throw new ApiError(response.status, extractReasonCode(body), body);
}
export async function hashAidtResearchBytes(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(value => value.toString(16).padStart(2, "0")).join("");
}
/** Actual signed files upload. No message is posted and no model is invoked. */
export async function uploadAidtResearchMaterial(context: AidtMaterialContext, file: File, onDuplicate: "use-existing" | "as-new-version"): Promise<AidtMaterialReceipt> {
  assertCurrent(context);
  const sha256 = await hashAidtResearchBytes(await file.arrayBuffer()); assertCurrent(context);
  const meta = C.operations.uploadArtifact.in.parse({ projectId: context.projectId, agendaSegmentId: null, files: [{ filename: file.name, sizeBytes: file.size, sha256 }], confidential: false, visibilityScope: "org-wide", onDuplicate });
  const form = new FormData(); form.append("meta", JSON.stringify(meta)); form.append("files", file, file.name);
  const response = await fetch(apiUrl(C.operations.uploadArtifact.path.replace(":projectId", encodeURIComponent(context.projectId))), { method: "POST", body: form, headers: { Authorization: `Bearer ${context.sessionToken}` }, credentials: "include", signal: context.signal });
  assertCurrent(context); if (!response.ok) return responseError(response);
  const result = C.operations.uploadArtifact.out.parse(await response.json()); assertCurrent(context);
  if (result.runs.length !== 1 || !result.runs[0]?.artifactId) throw new Error("AIDT_MATERIAL_RECEIPT_INVALID");
  return { projectId: context.projectId, runId: identifier.parse(result.runs[0].ingestionRunId), artifactId: identifier.parse(result.runs[0].artifactId), name: file.name, sha256, bytes: file.size, ...(result.runs[0].duplicateHit ? { duplicateAction: onDuplicate } : {}) };
}
/** Reads the real receipt and original bytes. STORED does not imply extraction or model use. */
export async function readAidtResearchMaterial(context: AidtMaterialContext, reference: AidtMaterialReceipt | AidtResearchMaterialReference) {
  assertCurrent(context);
  if (reference.projectId !== context.projectId) throw new Error("AIDT_MATERIAL_SCOPE_MISMATCH");
  const headers = { Authorization: `Bearer ${context.sessionToken}` };
  const statusResponse = await fetch(apiUrl(`/ingestion-runs/${encodeURIComponent(identifier.parse(reference.runId))}?projectId=${encodeURIComponent(context.projectId)}`), { headers, signal: context.signal });
  assertCurrent(context);
  let status: z.infer<typeof C.operations.getIngestionRun.out> | null = null, processingFailed = false;
  if (!statusResponse.ok) {
    let body: unknown; try { body = await statusResponse.json(); } catch { body = undefined; }
    assertCurrent(context);
    if (statusResponse.status !== 422 || extractReasonCode(body) !== "INGESTION_FAILED") throw new ApiError(statusResponse.status, extractReasonCode(body), body);
    processingFailed = true;
  } else {
    status = C.operations.getIngestionRun.out.parse(await statusResponse.json()); assertCurrent(context);
    if (status.ingestionRunId !== reference.runId || !status.originalDownloadable) throw new Error("AIDT_MATERIAL_NOT_READABLE");
  }
  const response = await fetch(apiUrl(aidtResearchContentPath(reference)), { headers, signal: context.signal });
  assertCurrent(context); if (!response.ok) return responseError(response);
  const bytes = await response.arrayBuffer(); assertCurrent(context);
  const sha256 = await hashAidtResearchBytes(bytes); assertCurrent(context);
  const mime = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (sha256 !== reference.sha256 || response.headers.get("X-Content-SHA256") !== sha256 || response.headers.get("X-Artifact-Id") !== reference.artifactId || bytes.byteLength !== reference.bytes) throw new Error("AIDT_MATERIAL_INTEGRITY_FAILED");
  const submittedBy = response.headers.get("X-Upload-Submitted-By"), submittedAt = response.headers.get("X-Upload-Submitted-At");
  const resolved = AidtResearchMaterial.parse({ projectId: reference.projectId, runId: reference.runId, artifactId: reference.artifactId, name: reference.name, bytes: reference.bytes, sha256: reference.sha256, versionId: response.headers.get("X-Artifact-Version-Id"), mime, ...(submittedBy !== null || submittedAt !== null ? { submittedBy: submittedBy ?? undefined, submittedAt: submittedAt ?? undefined } : {}) });
  if ("versionId" in reference && (resolved.versionId !== reference.versionId || resolved.mime !== reference.mime)) throw new Error("AIDT_MATERIAL_INTEGRITY_FAILED");
  return { reference: resolved, blob: new Blob([bytes], { type: mime }), status, processingFailed };
}
/** Reuses only persisted materials from this project's authorized stage snapshots. */
export async function listAidtResearchMaterials(context: AidtMaterialContext): Promise<AidtResearchMaterialReference[]> {
  assertCurrent(context); const result = await listAidtStages(context.projectId, context.sessionToken, context.signal); assertCurrent(context);
  const stages = await Promise.all(result.items.filter(item => item.revision > 0).map(item => readAidtStage(context.projectId, item.stageId, context.sessionToken, context.signal))); assertCurrent(context);
  const found = new Map<string, AidtResearchMaterialReference>();
  for (const { stage } of stages) {
    if (!stage) continue;
    if (stage.projectId !== context.projectId) throw new Error("AIDT_MATERIAL_SCOPE_MISMATCH");
    for (const { material } of aidtResearchMaterialsFromFields(stage.content.draft.fields, context.projectId)) found.set(`${material.artifactId}:${material.versionId}`, material);
  }
  return [...found.values()];
}
