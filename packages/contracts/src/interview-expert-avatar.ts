import { z } from "zod";

/** First-party illustrations only. SVG markup is never accepted as preference data. */
export const AVATAR_KEYS = [
  "person-1", "person-2", "person-3", "person-4", "person-5", "person-6",
  "person-7", "person-8", "person-9", "person-10", "person-11", "person-12",
  "person-13", "person-14", "person-15", "person-16", "person-17", "person-18",
  "person-19", "person-20", "person-21", "person-22", "person-23", "person-24", "robot",
] as const;
export const AvatarKey = z.enum(AVATAR_KEYS);
export const ExpertAvatarPreference = z.object({
  expertId: z.string().min(1).max(256), avatarKey: AvatarKey.nullable(), version: z.number().int().nonnegative(),
}).strict();
export const SaveExpertAvatarPreference = z.object({
  avatarKey: AvatarKey.nullable(), expectedVersion: z.number().int().nonnegative(),
}).strict();
export type ExpertAvatarPreference = z.infer<typeof ExpertAvatarPreference>;
export const ExpertAvatarContext = z.object({ interviewId: z.string().min(1).max(256), revisionId: z.string().min(1).max(256) }).strict();
export type ExpertAvatarContext = z.infer<typeof ExpertAvatarContext>;
export const SaveInterviewExpertAvatarPreference = SaveExpertAvatarPreference.extend({ revisionId: ExpertAvatarContext.shape.revisionId }).strict();
