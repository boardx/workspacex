import { z } from "zod";
import { KernelInterjection } from "./artifacts-steering";
export const InterjectionPollInput = z.object({ orgId: z.string().min(1), acknowledgedIds: z.array(z.string().min(1)).max(100) }).strict();
export const InterjectionPollOutput = z.object({ interjections: z.array(KernelInterjection).max(100), pauseRequested: z.boolean() }).strict();
