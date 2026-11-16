import { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import type { AidtSharedContextReference } from "./aidt-chat-shared-context";

/** Chat reads saved provenance; a local next-round draft cannot alter saved source selection. */
export function aidtStageContextReferences(stageId: number, stages: Readonly<Record<number, {stageId:number;revision:number;sourceStageRevisions?:readonly {stageId:number;revision:number}[]}>>): AidtSharedContextReference[] {
  const selected = new Map(Object.values(stages).filter(stage => stage.stageId <= stageId).map(stage => [stage.stageId, stage.revision]));
  for (const source of stages[stageId]?.sourceStageRevisions ?? []) selected.set(source.stageId, source.revision);
  return [...selected].sort(([a],[b]) => a-b).map(([stageNumber,revision]) => ({stageNumber,revision}));
}

/** Coordinates only: the server independently authorizes and rereads every revision. */
export function aidtStageContextSelector(projectId: string, stageId: number, references: readonly AidtSharedContextReference[], returnRevision?: string | null): AidtContextSelector {
  if (returnRevision != null && !/^[1-9]\d*$/.test(returnRevision)) throw new Error("AIDT_CONTEXT_INVALID");
  return AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "stage", stageId,
    stageRevisions: references.map(ref => ({ stageId: ref.stageNumber, revision: ref.revision })),
    ...(returnRevision != null ? { returnRevision: Number(returnRevision) } : {}) });
}
export function aidtSummaryContextSelector(projectId: string, packet: { projectId: string; currentStages: readonly { stageId: number; revision: number }[]; historyRevisions: readonly { stageId: number; revision: number }[] }): AidtContextSelector {
  if (packet.projectId !== projectId) throw new Error("AIDT_CONTEXT_INVALID");
  return AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "summary",
    stageRevisions: packet.currentStages.map(({ stageId, revision }) => ({ stageId, revision })),
    historyRevisions: packet.historyRevisions.map(({ stageId, revision }) => ({ stageId, revision })) });
}
