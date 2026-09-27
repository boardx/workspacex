import { interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

/** Live identity creation only; research bodies are saved by the Markdown API. */
export function createDigitalInterviewDraft(input: z.infer<typeof interview.operations.createDigitalInterviewDraft.in>) {
  return apiRequest<z.infer<typeof interview.DigitalInterviewWorkflowView>>("/interviews/digital", {
    method: "POST",
    body: input,
  });
}
