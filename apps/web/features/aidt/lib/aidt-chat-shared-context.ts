import { StageContent } from "@repo/contracts/aidt-stages";
import { aidtUiStageSummary } from "./aidt-ui-drafts";
import { readAidtStage, listAidtStageHistory } from "./live-aidt-stages";
import { isAidtModuleEnabled } from "./aidt-module-config";

/** A real server revision, never a page draft or a claim of group agreement. */
export type AidtSharedContextReference = Readonly<{ stageNumber: number; revision: number }>;
export type AidtSharedContextItem = Readonly<{
  kind: "aidt-stage";
  projectId: string;
  stageNumber: number;
  revision: number;
  updatedBy: string;
  updatedAt: string;
  sourceStageRevisions: readonly Readonly<{ stageId: number; revision: number }>[];
  draftText: string;
  truncated: boolean;
  reviewStatus: "not-confirmed";
  evidenceStatus: "not-verified";
  visibility: "group-shared";
}>;
export type AidtSharedContextIssue = Readonly<{ stageNumber: number; reason: "unavailable" | "version-changed" | "limit" }>;
export type AidtSharedChatContext = Readonly<{
  status: "not-selected" | "ready" | "partial" | "failed";
  items: readonly AidtSharedContextItem[];
  issues: readonly AidtSharedContextIssue[];
}>;
export const AIDT_EMPTY_SHARED_CONTEXT: AidtSharedChatContext = { status: "not-selected", items: [], issues: [] };
const MAX_ITEM_CHARS = 5000, MAX_TOTAL_CHARS = 20000;

/** Authorized, bounded readback of explicitly referenced current/earlier shared stages. */
export async function loadAidtSharedChatContext({ projectId, currentStage, sessionToken, references, signal }: {
  projectId: string;
  currentStage: number;
  sessionToken: string;
  references: readonly AidtSharedContextReference[];
  signal?: AbortSignal;
}): Promise<AidtSharedChatContext> {
  const assertCurrent = () => { if (signal?.aborted || !isAidtModuleEnabled()) throw new Error("AIDT_CONTEXT_CHANGED"); };
  assertCurrent();
  if (!references.length) return AIDT_EMPTY_SHARED_CONTEXT;
  if (!Number.isInteger(currentStage) || currentStage < 1 || currentStage > 6 || references.length > 6) return { status: "failed", items: [], issues: [{ stageNumber: 0, reason: "limit" }] };
  const items: AidtSharedContextItem[] = [], issues: AidtSharedContextIssue[] = [], selected = new Map<number, number>();
  // Reject ambiguous duplicate selections before any content read.
  for (const reference of references) {
    if (selected.has(reference.stageNumber) && selected.get(reference.stageNumber) !== reference.revision) return { status: "failed", items: [], issues: [{ stageNumber: reference.stageNumber, reason: "version-changed" }] };
    selected.set(reference.stageNumber, reference.revision);
  }
  let remaining = MAX_TOTAL_CHARS;
  for (const [stageNumber, revision] of selected) {
    assertCurrent();
    if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > currentStage || !Number.isInteger(revision) || revision < 1) { issues.push({ stageNumber, reason: "unavailable" }); continue; }
    if (!remaining) { issues.push({ stageNumber, reason: "limit" }); continue; }
    try {
      let { stage } = await readAidtStage(projectId, stageNumber, sessionToken, signal);
      assertCurrent();
      if (!stage || stage.projectId !== projectId || stage.stageId !== stageNumber) { issues.push({ stageNumber, reason: "unavailable" }); continue; }
      // A selected immutable version can predate its head (for example a frozen test round).
      // Ask the existing history endpoint for that exact coordinate, never the closest record.
      if (stage.revision > revision) {
        const page = await listAidtStageHistory(projectId, stageNumber, sessionToken, { beforeRevision: revision + 1, limit: 1 }, signal);
        assertCurrent();
        const historical = page.items.length === 1 ? page.items[0] : undefined;
        if (!historical || historical.projectId !== projectId || historical.stageId !== stageNumber || historical.revision !== revision) { issues.push({ stageNumber, reason: "version-changed" }); continue; }
        stage = historical;
      }
      if (stage.revision !== revision) { issues.push({ stageNumber, reason: "version-changed" }); continue; }
      const fullText = JSON.stringify(stage.content);
      let draftText = fullText.slice(0, Math.min(MAX_ITEM_CHARS, remaining));
      if (/[\uD800-\uDBFF]$/.test(draftText)) draftText = draftText.slice(0, -1);
      remaining -= draftText.length;
      items.push({ kind: "aidt-stage", projectId, stageNumber, revision, updatedBy: stage.updatedBy, updatedAt: stage.updatedAt,
        sourceStageRevisions: stage.sourceStageRevisions.map((source) => ({ ...source })), draftText, truncated: draftText.length < fullText.length,
        reviewStatus: "not-confirmed", evidenceStatus: "not-verified", visibility: "group-shared" });
    } catch {
      assertCurrent(); issues.push({ stageNumber, reason: "unavailable" });
    }
  }
  return { status: issues.length ? items.length ? "partial" : "failed" : "ready", items, issues };
}

/** Readable student-authored source; render as plain text, never executable markup. */
export function aidtSharedContextPreview(item: AidtSharedContextItem): string {
  try {
    const parsed = StageContent.safeParse(JSON.parse(item.draftText));
    if (parsed.success && Number.isInteger(item.stageNumber) && item.stageNumber >= 1 && item.stageNumber <= 6) return aidtUiStageSummary(item.stageNumber, parsed.data.draft) || item.draftText;
  } catch { /* Truncated or older saved text stays visible as a literal page preview. */ }
  return item.draftText;
}
