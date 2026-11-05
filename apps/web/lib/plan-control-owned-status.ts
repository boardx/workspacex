import { deriveRunStatusView, type RunStatusView, type RunStatusViewInput } from "@repo/contracts/plan-control";

// These probes obtain owned display labels from the authoritative contract.
// They do not decide the current run's state: only deriveRunStatusView does that.
// Never pass model/user/error strings through this display projection.
const base: RunStatusViewInput = {
  phase: "preparing", runStatus: "idle", stepStatuses: [],
  progressCompleted: 0, progressTotal: 0, paused: false,
  pauseRequested: false, gateRequired: false, hasRecentError: false,
  pauseEntryEnabled: false,
};
const owned = (input: Partial<RunStatusViewInput>) => deriveRunStatusView({ ...base, ...input }).stateLabel;
export const PLAN_CONTROL_STATUS_ZH = {
  stopped: owned({ phase: "cancelled" }),
  failedMarked: owned({ phase: "failed", progressCompleted: 1, progressTotal: 1 }),
  failed: owned({ phase: "failed" }),
  done: owned({ phase: "done" }),
  paused: owned({ paused: true }),
  unconfirmed: owned({ hasRecentError: true }),
  pausing: owned({ pauseEntryEnabled: true, pauseRequested: true }),
  approval: owned({ phase: "approving" }),
  confirmation: owned({ phase: "planning", gateRequired: true }),
  settling: owned({ phase: "executing", runStatus: "running", stepStatuses: ["completed"], progressCompleted: 1, progressTotal: 1 }),
  running: owned({ phase: "executing", runStatus: "running", stepStatuses: ["pending"], progressTotal: 1 }),
  idle: owned({}),
} as const;
type StatusName = keyof typeof PLAN_CONTROL_STATUS_ZH;
export type PlanControlStatusMessageKey = `chatPlanControl.status.${StatusName}`;
const ownedLabelKeys = new Map<string, PlanControlStatusMessageKey>(
  (Object.keys(PLAN_CONTROL_STATUS_ZH) as StatusName[]).map((name): [string, PlanControlStatusMessageKey] => [PLAN_CONTROL_STATUS_ZH[name], `chatPlanControl.status.${name}`]),
);
export function planControlStatusMessageKey(view: Pick<RunStatusView, "stateLabel">): PlanControlStatusMessageKey | undefined {
  return ownedLabelKeys.get(view.stateLabel);
}
