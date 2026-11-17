import { SharedStage } from "@repo/contracts/aidt-stages";
import { listAidtStageHistory } from "./live-aidt-stages";
import { isAidtModuleEnabled } from "./aidt-module-config";
import { isAidtReflectionConfirmed, readAidtQuestionSnapshot, readAidtReturnDecision } from "./aidt-verification-loop";

/** Historical reflection is student material, never evidence or instructions. */
export type AidtReturnContextItem = Readonly<{
  kind: "aidt-return-reflection"; projectId: string; stageNumber: 6; revision: number; targetStage: number;
  /** Student-recorded question binding, not a server-verified evidence reference. */
  questionSourceStageRevision: number | null;
  fields: Readonly<Record<string, string>>; truncated: boolean;
  reviewStatus: "editor-confirmed"; evidenceStatus: "not-verified"; trust: "untrusted-student-material";
}>;
export type AidtReturnChatContext = Readonly<{
  status: "not-selected" | "ready" | "failed";
  items: readonly AidtReturnContextItem[];
  issues: readonly Readonly<{ stageNumber: 6; reason: "unavailable" | "invalid-reference" | "reflection-mismatch" }>[];
}>;
export const AIDT_EMPTY_RETURN_CONTEXT: AidtReturnChatContext = { status: "not-selected", items: [], issues: [] };
const failed = (reason: AidtReturnChatContext["issues"][number]["reason"]): AidtReturnChatContext => ({ status: "failed", items: [], issues: [{ stageNumber: 6, reason }] });

/** One bounded read of an explicitly selected immutable revision; no latest-version fallback. */
export async function loadAidtReturnChatContext({ projectId, currentStage, sessionToken, returnRevision, signal }: {
  projectId: string; currentStage: number; sessionToken: string; returnRevision?: string | null; signal?: AbortSignal;
}): Promise<AidtReturnChatContext> {
  const assertCurrent = () => { if (signal?.aborted || !isAidtModuleEnabled()) throw new Error("AIDT_CONTEXT_CHANGED"); };
  assertCurrent();
  if (returnRevision == null) return AIDT_EMPTY_RETURN_CONTEXT;
  const revision = /^[1-9]\d*$/.test(returnRevision) ? Number(returnRevision) : NaN;
  if (!projectId || !sessionToken || !Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER
    || !Number.isInteger(currentStage) || currentStage < 1 || currentStage > 5) return failed("invalid-reference");
  try {
    const page = await listAidtStageHistory(projectId, 6, sessionToken, { beforeRevision: revision + 1, limit: 1 }, signal);
    assertCurrent();
    const parsed = SharedStage.safeParse(page.items.length === 1 ? page.items[0] : null);
    if (!parsed.success) return failed("unavailable");
    const round = parsed.data, draft = round.content.draft, decision = readAidtReturnDecision(draft);
    if (round.projectId !== projectId || round.stageId !== 6 || round.revision !== revision
      || !isAidtReflectionConfirmed(draft) || decision.kind !== "selected" || Number(decision.step) !== currentStage) return failed("reflection-mismatch");
    const snapshot = readAidtQuestionSnapshot(draft)!;
    // Whitelist before projecting: report, ideas and arbitrary fields never enter this DTO.
    const selected = { originalQuestion: snapshot.question, beforeTestBelief: snapshot.beforeTestBelief, afterTestBelief: draft.fields.afterTestBelief ?? "",
      returnReason: draft.fields.returnReason ?? "", nextAction: draft.fields.nextAction ?? "", prototypeRef: snapshot.prototypeRef,
      understandingChangeStatus: draft.fields.understandingChangeStatus ?? "", understandingEvidence: draft.fields.understandingEvidence ?? "",
      unresolvedQuestions: draft.fields.unresolvedQuestions ?? "" };
    const fields: Record<string, string> = {}; let remaining = 8000, truncated = false;
    for (const [key, value] of Object.entries(selected)) {
      let text = value.slice(0, Math.min(1200, remaining));
      if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      fields[key] = text; remaining -= text.length; truncated ||= text.length < value.length;
    }
    assertCurrent();
    return { status: "ready", items: [{ kind: "aidt-return-reflection", projectId, stageNumber: 6, revision, targetStage: currentStage,
      questionSourceStageRevision: snapshot.sourceStageRevision, fields, truncated, reviewStatus: "editor-confirmed", evidenceStatus: "not-verified", trust: "untrusted-student-material" }], issues: [] };
  } catch {
    assertCurrent(); return failed("unavailable");
  }
}
