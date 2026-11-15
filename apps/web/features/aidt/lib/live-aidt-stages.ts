import { operations, type SharedStageValue, type SaveStageInput } from "@repo/contracts/aidt-stages";
import { apiRequest } from "@/lib/api-client";

export type AidtSharedStage = SharedStageValue;
export type AidtSaveStageInput = SaveStageInput;
function path(projectId: string, stageId?: number) {
  return `/projects/${encodeURIComponent(projectId)}/aidt/stages${stageId === undefined ? "" : `/${stageId}`}`;
}
export async function listAidtStages(projectId: string, sessionToken: string, signal?: AbortSignal) {
  operations.list.in.parse({ projectId });
  return operations.list.out.parse(await apiRequest<unknown>(path(projectId), { method: "GET", sessionToken, signal }));
}
export async function readAidtStage(projectId: string, stageId: number, sessionToken: string, signal?: AbortSignal) {
  operations.get.in.parse({ projectId, stageId });
  const result = operations.get.out.parse(await apiRequest<unknown>(path(projectId, stageId), { method: "GET", sessionToken, signal }));
  if (result.stage && (result.stage.projectId !== projectId || result.stage.stageId !== stageId)) throw new Error("AIDT_STAGE_SCOPE_MISMATCH");
  return result;
}
export async function saveAidtStage(input: AidtSaveStageInput, sessionToken: string, signal?: AbortSignal) {
  const body = operations.save.in.parse(input);
  const result = operations.save.out.parse(await apiRequest<unknown>(path(body.projectId, body.stageId), { method: "PUT", sessionToken, signal, body }));
  if (result.stage.projectId !== body.projectId || result.stage.stageId !== body.stageId) throw new Error("AIDT_STAGE_SCOPE_MISMATCH");
  return result;
}

/** Read-only access to the existing immutable revision endpoint. */
export async function listAidtStageHistory(projectId: string, stageId: number, sessionToken: string, options: { beforeRevision?: number; limit?: number } = {}, signal?: AbortSignal) {
  const input = operations.history.in.parse({ projectId, stageId, ...options });
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.beforeRevision !== undefined) query.set("beforeRevision", String(input.beforeRevision));
  const result = operations.history.out.parse(await apiRequest<unknown>(`${path(projectId, stageId)}/revisions?${query}`, { method: "GET", sessionToken, signal }));
  if (result.items.some((stage) => stage.projectId !== projectId || stage.stageId !== stageId)) throw new Error("AIDT_STAGE_SCOPE_MISMATCH");
  if (result.items.length > input.limit || result.items.some((stage, index) =>
    (input.beforeRevision !== undefined && stage.revision >= input.beforeRevision)
    || (index > 0 && stage.revision >= result.items[index - 1]!.revision))
    || (result.nextBeforeRevision !== null && result.nextBeforeRevision !== result.items.at(-1)?.revision)) throw new Error("AIDT_STAGE_HISTORY_INVALID");
  return result;
}
