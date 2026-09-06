import type { OrgId } from "../../domain/org-id";
import { classifyToolCallRisk, resolveSkillRiskLevels } from "../../domain/agent-run/skill-risk-level";
import type { AgentRunStore } from "./ports";
import type { ToolPermissionGrantStore } from "./tool-permission-grants";
export const TOOL_EXECUTION_AUTHORITY = Symbol("ToolExecutionAuthority");
export interface ToolExecutionCheck {
  readonly orgId: OrgId;
  readonly parentRunId: string;
  readonly attemptId: string;
  readonly leaseEpoch: number;
  readonly toolName: string;
  readonly skillStableName?: string;
}
export type ToolExecutionDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: "run_unavailable" | "cancel_requested" | "lease_lost" | "attempt_stale" | "skill_not_mounted" | "approval_required" };
export interface ToolAuthoritySnapshot {
  readonly active: boolean;
  readonly cancelRequested: boolean;
  readonly leaseValid: boolean;
  readonly attemptId: string | null;
  readonly skillVersionIds: readonly string[];
}
export interface ToolAuthorityReader {
  /** Keep the run row locked for the check to avoid cancellation/grant races. */
  withSnapshot<T>(input: ToolExecutionCheck, check: (snapshot: ToolAuthoritySnapshot | null) => Promise<T>): Promise<T>;
}
/** Trusted runtime boundary only: neither model args nor a browser may choose org/epoch.
 * This check authorizes dispatch now; it is not a reusable grant or exactly-once token. */
export class ToolExecutionAuthority {
  constructor(private readonly reader: ToolAuthorityReader, private readonly runs: Pick<AgentRunStore, "readPinnedSkills">,
    private readonly grants: ToolPermissionGrantStore) {}
  check(input: ToolExecutionCheck): Promise<ToolExecutionDecision> {
    return this.reader.withSnapshot(input, async snapshot => {
      if (!snapshot || !snapshot.active) return { allowed: false, reason: "run_unavailable" };
      if (snapshot.cancelRequested) return { allowed: false, reason: "cancel_requested" };
      if (!snapshot.leaseValid) return { allowed: false, reason: "lease_lost" };
      if (snapshot.attemptId !== input.attemptId) return { allowed: false, reason: "attempt_stale" };
      const skills = input.toolName === "call_skill" ? await this.runs.readPinnedSkills(input.orgId, snapshot.skillVersionIds) : [];
      if (input.toolName === "call_skill" && !skills.some(skill => skill.stableName === input.skillStableName)) {
        return { allowed: false, reason: "skill_not_mounted" };
      }
      const risk = classifyToolCallRisk(input, resolveSkillRiskLevels(skills));
      if (risk === "L2" && !await this.grants.hasGrant(input.orgId, input.parentRunId, input.toolName)) {
        return { allowed: false, reason: "approval_required" };
      }
      return { allowed: true };
    });
  }
}
