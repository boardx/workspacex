import { z } from "zod";
/** Shared wire vocabulary for interview and research NDJSON streams. Domain
 * schemas extend the result locator and optional ordering metadata. */
export const GenerationStreamAttempt = z.object({ type: z.literal("attempt"), attempt: z.number().int().positive() }).strict();
export const GenerationStreamStage = z.object({ type: z.literal("stage"), stage: z.string().min(1) }).strict();
export const GenerationStreamDelta = z.object({ type: z.literal("delta"), delta: z.string() }).strict();
export const GenerationStreamCompleted = z.object({ type: z.literal("completed"), source: z.unknown() }).strict();
export const GenerationStreamFailed = z.object({ type: z.literal("failed"), reasonCode: z.string().min(1) }).strict();
