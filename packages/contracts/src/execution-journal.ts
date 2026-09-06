import { SkillActivityFact } from "./skill-activity";
import { z } from "zod";
import { InterjectionStatus } from "./interjection-status";

/** Durable public execution activity; never contains private model reasoning. */
export const AGUI_EXECUTION_EVENT_NAME = "execution_event" as const;
const base = { source: z.literal("legacy").optional(), attemptId: z.string().optional(), runId: z.string().min(1), seq: z.number().int().nonnegative(), emittedAt: z.string() };
export const ExecutionEvent = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("skill_activity"), fact: SkillActivityFact }),
  z.object({ ...base, kind: z.literal("interjection"), interjectionId: z.string(), text: z.string(), status: InterjectionStatus }),
  z.object({ ...base, kind: z.literal("status"), status: z.enum(["running", "succeeded", "failed", "paused", "cancelled", "awaiting_tool_permission"]) }),
  z.object({ ...base, kind: z.literal("final_message"), messageId: z.string().min(1) }),
  z.object({ ...base, kind: z.literal("text_delta"), messageId: z.string().min(1), delta: z.string() }),
  z.object({ ...base, kind: z.literal("tool_start"), toolCallId: z.string().min(1), sourceToolCallId: z.string().min(1).optional(), toolName: z.string(), args: z.unknown(), planningNote: z.string().max(4000).optional() }),
  z.object({ ...base, kind: z.literal("tool_end"), toolCallId: z.string().min(1), sourceToolCallId: z.string().min(1).optional(), toolName: z.string(), result: z.unknown(), ok: z.boolean() }),
]);
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;
export type ExecutionEventInput = ExecutionEvent extends infer E ? E extends ExecutionEvent ? Omit<E, "runId" | "seq" | "emittedAt"> : never : never;
export function parseExecutionEvent(value: unknown): ExecutionEvent | null {
  const parsed = ExecutionEvent.safeParse(value);
  return parsed.success ? parsed.data : null;
}
