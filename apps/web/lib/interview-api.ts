import { interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type DigitalInterviewHistory = z.infer<typeof interview.operations.listDigitalInterviews.out>;
export type DigitalInterviewHistoryRow = z.infer<typeof interview.DigitalInterviewHistoryRow>;
export type DigitalExpertCatalog = z.infer<typeof interview.operations.listDigitalExperts.out>;
export type DigitalExpertCatalogRow = z.infer<typeof interview.DigitalExpertCatalogRow>;
export type QuickDigitalInterview = z.infer<typeof interview.QuickDigitalInterview>;

export function loadDigitalInterviewHistory(status?: string): Promise<DigitalInterviewHistory> {
  return apiRequest("/interviews/digital", { query: { status } });
}

export function loadDigitalExperts(domain?: string): Promise<DigitalExpertCatalog> {
  return apiRequest("/interviews/digital/experts", { query: { domain } });
}

export function startQuickDigitalInterview(expertId: string, requestId: string) {
  return apiRequest<QuickDigitalInterview>("/interviews/digital/quick", {
    method: "POST",
    body: { expertId, requestId },
  });
}

export function loadQuickDigitalInterview(interviewId: string) {
  return apiRequest<QuickDigitalInterview>(`/interviews/digital/quick/${interviewId}`);
}

export function sendQuickDigitalInterviewMessage(
  interviewId: string,
  text: string,
  expectedVersion: number,
) {
  return apiRequest<QuickDigitalInterview>(
    `/interviews/digital/quick/${interviewId}/messages`,
    { method: "POST", body: { interviewId, text, expectedVersion } },
  );
}

export function convertQuickDigitalInterview(quick: QuickDigitalInterview) {
  return apiRequest<z.infer<typeof interview.ConvertedDigitalInterview>>(
    `/interviews/digital/quick/${quick.interviewId}/convert`,
    {
      method: "POST",
      body: {
        interviewId: quick.interviewId,
        expectedVersion: quick.version,
        name: `${quick.expert.displayName} · 批量访谈`,
        tags: ["快捷访谈"],
        topic: quick.messages.find((message) => message.role === "user")?.text
          ?? "延续快捷访谈主题",
      },
    },
  );
}
