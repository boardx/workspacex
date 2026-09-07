import { z } from "zod";
export const InterjectionStatus = z.enum(["received","applied","not_applied"]);
export const PublicInterjection = z.object({interjectionId:z.string(),text:z.string(),status:InterjectionStatus,receivedAt:z.string(),appliedAt:z.string().nullable()}).strict();
export type PublicInterjection = z.infer<typeof PublicInterjection>;
export const operations={list:{method:"GET",path:"/agent-runs/:runId/interjections",out:z.object({items:z.array(PublicInterjection)}).strict()}};
