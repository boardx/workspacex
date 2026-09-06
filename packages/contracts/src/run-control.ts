import { z } from "zod";
import { KernelInterjection } from "./artifacts-steering";
export const InterjectionPollInput = z.object({ orgId: z.string().min(1), acknowledgedIds: z.array(z.string().min(1)).max(100) }).strict();
export const InterjectionPollOutput = z.object({ interjections: z.array(KernelInterjection).max(100), pauseRequested: z.boolean(), cancelRequested: z.boolean().default(false) }).strict();

export const ChildCancellationStatus = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not_requested") }),
  z.object({ kind: z.literal("unavailable") }),
  z.object({ kind: z.literal("pending"), runningChildIds: z.array(z.string()) }),
  z.object({ kind: z.literal("confirmed") }),
]);
export const ToolExecutionCheckInput = z.object({
  orgId: z.string().min(1), attemptId: z.string().min(1), leaseEpoch: z.number().int().positive(),
  toolName: z.string().min(1), skillStableName: z.string().min(1).optional(),
}).strict();
export const ToolExecutionCheckOutput = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }),
  z.object({ allowed: z.literal(false), reason: z.enum(["run_unavailable", "cancel_requested", "lease_lost", "attempt_stale", "skill_not_mounted", "approval_required"]) }),
]);
export const CancelRunOutput = z.object({ runId: z.string(), status: z.enum(["cancel_requested", "cancelled"]), childCancellation: ChildCancellationStatus.optional() }).strict();
