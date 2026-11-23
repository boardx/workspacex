import { readAidtStage, readAidtStageRevision } from "./live-aidt-stages";
import { readAidtPrototypeEntityDraft, readAidtPrototypeInputSelection } from "./aidt-prototype-handoff";
import { isAidtPrototypeTextConfirmed, readAidtPrototypeTextConfirmation, readAidtPrototypeLineage, aidtPrototypeTextHashes } from "./aidt-prototype-text-state";
import { loadAidtPrototypeTextSources } from "./aidt-prototype-text-sources";
import { AidtPrototypeTextConfirmation as Confirmation, type AidtPrototypeTextOutputBinding } from "@repo/contracts/aidt-prototype-text";
import * as project from "@repo/contracts/project";
import { apiRequest } from "@/lib/api-client";

async function requireProjectDesignLink(input: { projectId: string; designId: string; sessionToken: string; signal?: AbortSignal }) {
  const operation = project.operations.listProjectResources;
  const resources = operation.out.parse(await apiRequest<unknown>(operation.path.replace(":projectId", encodeURIComponent(input.projectId)), {
    method: "GET", sessionToken: input.sessionToken, signal: input.signal,
  }));
  if (!resources.items.some(resource => resource.kind === "design" && resource.id === input.designId)) throw new Error("AIDT_PROTOTYPE_UNAVAILABLE");
}

/** Re-read server state at each explicit output action. A local confirmation,
 * cached context or a previously readable interview never authorizes generation. */
export async function loadAidtConfirmedPrototypeText(input: { projectId: string; designId: string; sessionToken: string; signal?: AbortSignal }) {
  const check = () => { if (input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED"); };
  check();
  await requireProjectDesignLink(input);
  const current = (await readAidtStage(input.projectId, 5, input.sessionToken, input.signal)).stage;
  const draft = current?.projectId === input.projectId && current.stageId === 5 ? readAidtPrototypeEntityDraft(current.content.draft, input.designId) : null;
  const confirmation = draft && readAidtPrototypeTextConfirmation(draft);
  const selection = draft && readAidtPrototypeInputSelection(draft);
  const lineage = draft && readAidtPrototypeLineage(draft);
  if (!draft || !confirmation || confirmation.projectId !== input.projectId || confirmation.designId !== input.designId || !selection?.brainstormId || !lineage
    || draft.fields.prototypeArchived === "true" || !isAidtPrototypeTextConfirmed(draft)) throw new Error("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
  const stage = await readAidtStageRevision(input.projectId, 5, confirmation.stageRevision, input.sessionToken, input.signal);
  const original = stage?.projectId === input.projectId && stage.stageId === 5 && stage.revision === confirmation.stageRevision
    ? readAidtPrototypeEntityDraft(stage.content.draft, input.designId) : null;
  if (!original || original.fields.prototypeTextDesign !== confirmation.text || original.fields.prototypeTextVersion !== confirmation.textVersion
    || original.fields.prototypeIdeaSource !== confirmation.selection || original.fields.prototypeTextLineage !== confirmation.lineage) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
  const sources = await loadAidtPrototypeTextSources({ ...input, selection, lineage });
  if (sources.restricted) throw new Error("AIDT_PROTOTYPE_SOURCE_REVOKED");
  check();
  return { draft, confirmation, sources, hashes: await aidtPrototypeTextHashes(confirmation) };
}

/** Older output keeps its own confirmed text revision even after the current
 * draft changes. Viewing it still checks current source permissions/consent. */
export async function loadAidtBoundPrototypeTextSources(input: { projectId: string; designId: string; sessionToken: string; signal?: AbortSignal }, binding: AidtPrototypeTextOutputBinding) {
  if (binding.projectId !== input.projectId || binding.designId !== input.designId) throw new Error("AIDT_PROTOTYPE_SOURCE_SCOPE_MISMATCH");
  await requireProjectDesignLink(input);
  const stage = await readAidtStageRevision(input.projectId, 5, binding.textStageRevision, input.sessionToken, input.signal);
  const draft = stage?.projectId === input.projectId ? readAidtPrototypeEntityDraft(stage.content.draft, input.designId) : null;
  const selection = draft && readAidtPrototypeInputSelection(draft), lineage = draft && readAidtPrototypeLineage(draft);
  if (!draft || !selection || !lineage) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
  const value = Confirmation.parse({ schemaVersion: 1, projectId: input.projectId, designId: input.designId, stageRevision: binding.textStageRevision,
    textVersion: draft.fields.prototypeTextVersion, text: draft.fields.prototypeTextDesign, selection: draft.fields.prototypeIdeaSource, lineage: draft.fields.prototypeTextLineage });
  const hashes = await aidtPrototypeTextHashes(value);
  if (value.textVersion !== binding.textVersion || hashes.textSha256 !== binding.textSha256 || hashes.lineageSha256 !== binding.lineageSha256) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
  const sources = await loadAidtPrototypeTextSources({ ...input, selection, lineage });
  if (sources.restricted) throw new Error("AIDT_PROTOTYPE_SOURCE_REVOKED");
  return sources;
}
