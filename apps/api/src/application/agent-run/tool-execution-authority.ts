import type { ToolExecutionCheckOutput } from "@repo/contracts/run-control";
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
  readonly permissionRequestId?: string;
  readonly toolCallId?: string;
  readonly toolArgs?: unknown;
}
export type ToolExecutionDecision = ToolExecutionCheckOutput;
export interface ToolAuthoritySnapshot {
  readonly active: boolean;
  readonly cancelRequested: boolean;
  readonly leaseValid: boolean;
  readonly attemptId: string | null;
  readonly skillVersionIds: readonly string[];
  readonly explicitlyDenied?: boolean;
  readonly authorizeOnce?: () => Promise<boolean>;
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
      const actualSkill = input.toolArgs && typeof input.toolArgs === "object" && !Array.isArray(input.toolArgs)
        ? (input.toolArgs as Record<string, unknown>).skill_stable_name : undefined;
      if (input.toolName === "call_skill" && (typeof actualSkill !== "string"
        || (input.skillStableName !== undefined && input.skillStableName !== actualSkill)
        || !skills.some(skill => skill.stableName === actualSkill))) {
        return { allowed: false, reason: "skill_not_mounted" };
      }
      if (snapshot.explicitlyDenied) return { allowed: false, reason: "approval_required" };
      const risk = classifyToolCallRisk({ ...input, skillStableName: typeof actualSkill === "string" ? actualSkill : undefined }, resolveSkillRiskLevels(skills));
      if (risk === "L2" && !await this.grants.hasGrant(input.orgId, input.parentRunId, input.toolName)
        && !await snapshot.authorizeOnce?.()) {
        return { allowed: false, reason: "approval_required" };
      }
      return { allowed: true };
    });
  }
}
