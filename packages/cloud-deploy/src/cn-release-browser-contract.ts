import { z } from "zod";

/** All six public journeys are required. Empty/partial reports are not success. */
export const cnReleaseBrowserSchema = z.object({
  login: z.literal(true), hello: z.literal(true), asr: z.literal(true),
  githubFeedbackRead: z.literal(true), skillTool: z.literal(true), pdfDownload: z.literal(true),
}).strict();
