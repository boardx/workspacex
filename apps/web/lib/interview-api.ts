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
export type DigitalInterviewWorkflowView = z.infer<typeof interview.DigitalInterviewWorkflowView>;
export type DigitalInterviewQuestion = z.infer<typeof interview.DigitalInterviewQuestion>;
export type DigitalInterviewStep = z.infer<typeof interview.DigitalInterviewStep>;
export type InterviewScope = z.infer<typeof interview.InterviewScope>;
export type CreateDigitalInterviewDraftInput = z.infer<typeof interview.operations.createDigitalInterviewDraft.in>;
export type DigitalInterviewSkillDraftContext = z.infer<typeof interview.DigitalInterviewSkillDraftContext>;

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

export function createDigitalInterviewDraft(input: CreateDigitalInterviewDraftInput) {
  return apiRequest<DigitalInterviewWorkflowView>("/interviews/digital", {
    method: "POST",
    body: input,
  });
}

export function loadDigitalInterview(interviewId: string) {
  if (interviewId.startsWith("mock-batch-")) {
    const mock = loadMockDigitalInterviewDraft(interviewId);
    if (mock) return Promise.resolve(mock);
  }
  return loadDigitalInterviewWorkflow(interviewId);
}

/** The workflow view is the only live recovery model; drafts never fall back to localStorage. */
export function loadDigitalInterviewWorkflow(interviewId: string) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${interviewId}`);
}

export function confirmDigitalInterviewTopic(input: {
  readonly interviewId: string;
  readonly topic: string;
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${input.interviewId}/topic/confirm`, {
    method: "POST",
    body: { topic: input.topic, expectedVersion: input.expectedVersion, requestId: input.requestId },
  });
}

export function confirmDigitalInterviewExperts(input: {
  readonly interviewId: string;
  readonly expertIds: readonly string[];
  readonly addedExperts: readonly DigitalExpertCatalogRow[];
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${input.interviewId}/experts/confirm`, {
    method: "POST",
    body: { expertIds: input.expertIds, addedExperts: input.addedExperts, expectedVersion: input.expectedVersion, requestId: input.requestId },
  });
}

export function confirmDigitalInterviewQuestions(input: {
  readonly interviewId: string;
  readonly questions: readonly DigitalInterviewQuestion[];
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${input.interviewId}/questions/confirm`, {
    method: "POST",
    body: { questions: input.questions, expectedVersion: input.expectedVersion, requestId: input.requestId },
  });
}

export function generateDigitalInterviewReport(input: {
  readonly interviewId: string;
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${input.interviewId}/report/generate`, {
    method: "POST",
    body: { expectedVersion: input.expectedVersion, requestId: input.requestId },
  });
}

export function appendDigitalInterviewSkillMessage(input: {
  readonly interviewId: string;
  readonly currentStep: DigitalInterviewStep;
  readonly text: string;
  readonly draftContext: DigitalInterviewSkillDraftContext;
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return apiRequest<DigitalInterviewWorkflowView>(`/interviews/digital/${input.interviewId}/skill/messages`, {
    method: "POST",
    body: { currentStep: input.currentStep, text: input.text, draftContext: input.draftContext, expectedVersion: input.expectedVersion, requestId: input.requestId },
  });
}

function changeDigitalInterviewSkillProposal(
  action: "apply" | "reject",
  input: { readonly interviewId: string; readonly proposalId: string; readonly expectedVersion: number; readonly requestId: string },
) {
  return apiRequest<DigitalInterviewWorkflowView>(
    `/interviews/digital/${input.interviewId}/skill/proposals/${input.proposalId}/${action}`,
    { method: "POST", body: { expectedVersion: input.expectedVersion, requestId: input.requestId } },
  );
}

export function applyDigitalInterviewSkillProposal(input: {
  readonly interviewId: string;
  readonly proposalId: string;
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return changeDigitalInterviewSkillProposal("apply", input);
}

export function rejectDigitalInterviewSkillProposal(input: {
  readonly interviewId: string;
  readonly proposalId: string;
  readonly expectedVersion: number;
  readonly requestId: string;
}) {
  return changeDigitalInterviewSkillProposal("reject", input);
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
