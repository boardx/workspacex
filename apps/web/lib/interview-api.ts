import { interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";
import {
  appendMockQuickMessage,
  isMockExpertId,
  isMockQuickInterviewId,
  loadMockQuickInterview,
  startMockQuickInterview,
} from "./mock/quick-digital-interview";
import {
  createMockDigitalInterviewDraft,
  loadMockDigitalInterviewDraft,
} from "./mock/digital-interview-drafts";

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
  if (isMockExpertId(expertId)) return Promise.resolve(startMockQuickInterview(expertId));
  return apiRequest<QuickDigitalInterview>("/interviews/digital/quick", {
    method: "POST",
    body: { expertId, requestId },
  });
}

export function loadQuickDigitalInterview(interviewId: string) {
  if (isMockQuickInterviewId(interviewId)) return Promise.resolve(loadMockQuickInterview(interviewId));
  return apiRequest<QuickDigitalInterview>(`/interviews/digital/quick/${interviewId}`);
}

export function sendQuickDigitalInterviewMessage(
  interviewId: string,
  text: string,
  expectedVersion: number,
) {
  if (isMockQuickInterviewId(interviewId)) {
    return Promise.resolve(appendMockQuickMessage(interviewId, text, expectedVersion));
  }
  return apiRequest<QuickDigitalInterview>(
    `/interviews/digital/quick/${interviewId}/messages`,
    { method: "POST", body: { interviewId, text, expectedVersion } },
  );
}

export function createDigitalInterviewDraft(input: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
}) {
  return Promise.resolve(createMockDigitalInterviewDraft(input));
}

export function loadDigitalInterview(interviewId: string) {
  const mock = loadMockDigitalInterviewDraft(interviewId);
  if (mock) return Promise.resolve(mock);
  return apiRequest<z.infer<typeof interview.DigitalInterview>>(`/interviews/digital/${interviewId}`);
}

export function convertQuickDigitalInterview(quick: QuickDigitalInterview) {
  if (isMockQuickInterviewId(quick.interviewId)) {
    return Promise.resolve(createMockDigitalInterviewDraft({
      name: `${quick.expert.displayName} · 批量访谈`,
      tags: ["快捷访谈"],
      topic: quick.messages.find((message) => message.role === "user")?.text ?? "延续快捷访谈主题",
    }));
  }
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
