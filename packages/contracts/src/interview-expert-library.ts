import { z } from 'zod';
const line = z.string().trim().min(1).max(200).refine(value => !/[\r\n]/u.test(value) && !/^#{1,6}\s/u.test(value));
const detail = z.string().trim().min(1).max(4000).refine(value => !/^#{1,6}\s/gmu.test(value));
/** Reusable simulated profiles are distinct from published Agent identities. */
export const InterviewExpertFields = z.object({name:line,role:line,domains:line,focus:detail,style:detail,bio:detail,limits:detail}).strict();
export type InterviewExpertFields = z.infer<typeof InterviewExpertFields>;
export const InterviewCustomExpert = z.object({expertId:z.string().startsWith('custom-expert-'),origin:z.literal('custom'),fields:InterviewExpertFields,createdAt:z.string()}).strict();
export type InterviewCustomExpert = z.infer<typeof InterviewCustomExpert>;
export const InterviewCustomExpertList = z.object({items:z.array(InterviewCustomExpert)}).strict();
export const CreateInterviewCustomExpert = z.object({fields:InterviewExpertFields,requestId:z.string().uuid()}).strict();
