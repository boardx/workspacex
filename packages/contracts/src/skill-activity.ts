import { z } from "zod";
const identity = {
  contractVersion: z.literal(1), factId: z.string().min(1).max(256),
  skillId: z.string().min(1).max(256), skillStableName: z.string().min(1).max(160),
  skillVersion: z.string().min(1).max(256), packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
const execution = { ...identity, toolCallId: z.string().min(1).max(256) };
/** Public provenance only. A body read is never evidence of execution success. */
export const SkillActivityFact = z.discriminatedUnion("stage", [
  z.object({ ...identity, stage: z.literal("metadata_discovered") }).strict(),
  z.object({ ...identity, stage: z.literal("body_read"), readPath: z.string().min(1).max(4096) }).strict(),
  z.object({ ...execution, stage: z.literal("execution_started") }).strict(),
  z.object({ ...execution, stage: z.literal("execution_succeeded") }).strict(),
  z.object({ ...execution, stage: z.literal("execution_failed"), errorCode: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/) }).strict(),
]);
export type SkillActivityFact = z.infer<typeof SkillActivityFact>;
export const SkillActivityStream = z.object({ type: z.literal("skill_activity"), version: z.literal(1), fact: SkillActivityFact }).strict();
