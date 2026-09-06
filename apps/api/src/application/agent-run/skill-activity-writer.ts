import type { SkillActivityFact } from "@repo/contracts/skill-activity";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "./ports";

/** Bind identity in the trusted executor; acknowledge only a completed journal write. */
export function createSkillActivityWriter(
  store: Pick<AgentRunStore, "appendExecutionEvent">,
  orgId: OrgId,
  runId: string,
  attemptId: string,
): (fact: SkillActivityFact) => Promise<void> {
  return async fact => {
    if (!store.appendExecutionEvent) throw new Error("skill_activity_writer_unavailable");
    await store.appendExecutionEvent(orgId, runId, { kind: "skill_activity", attemptId, fact });
  };
}
