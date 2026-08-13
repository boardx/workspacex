import type { QuickDigitalInterview } from "@/lib/interview-api";
import { findMockDigitalExpert, MOCK_EXPERT_ID_PREFIX } from "./digital-expert-personas";

const STORAGE_KEY = "wsx.mockDigitalQuickInterviews.v1";

export function isMockExpertId(expertId: string): boolean {
  return expertId.startsWith(MOCK_EXPERT_ID_PREFIX);
}

export function isMockQuickInterviewId(interviewId: string): boolean {
  return interviewId.startsWith("mock-quick-");
}

export function startMockQuickInterview(expertId: string): QuickDigitalInterview {
  const expert = findMockDigitalExpert(expertId);
  if (!expert) throw new Error("MOCK_EXPERT_NOT_FOUND");
  const interview: QuickDigitalInterview = {
    interviewId: `mock-quick-${expertId.slice(MOCK_EXPERT_ID_PREFIX.length)}`,
    expert,
    messages: [],
    version: 1,
  };
  write(interview);
  return interview;
}

export function loadMockQuickInterview(interviewId: string): QuickDigitalInterview {
  const found = readAll()[interviewId];
  if (!found) throw new Error("MOCK_INTERVIEW_NOT_FOUND");
  return found;
}

export function appendMockQuickMessage(
  interviewId: string,
  question: string,
  expectedVersion: number,
): QuickDigitalInterview {
  const current = loadMockQuickInterview(interviewId);
  if (current.version !== expectedVersion) throw new Error("CONCURRENT_MODIFICATION");
  const persona = findMockDigitalExpert(current.expert.expertId);
  if (!persona) throw new Error("MOCK_EXPERT_NOT_FOUND");
  const now = new Date().toISOString();
  const next: QuickDigitalInterview = {
    ...current,
    version: current.version + 1,
    messages: [
      ...current.messages,
      { messageId: crypto.randomUUID(), role: "user", text: question.trim(), exploratory: true, sourcePointers: [], createdAt: now },
      {
        messageId: crypto.randomUUID(), role: "assistant",
        text: `${persona.typicalAdvice}。结合你的问题，我建议先把假设拆成可验证的事实、约束和反例，再决定下一步行动。`,
        exploratory: true,
        sourcePointers: [`mock-persona:${persona.expertId.slice(MOCK_EXPERT_ID_PREFIX.length)}`],
        createdAt: now,
      },
    ],
  };
  write(next);
  return next;
}

function readAll(): Record<string, QuickDigitalInterview> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, QuickDigitalInterview>; } catch { return {}; }
}

function write(interview: QuickDigitalInterview): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [interview.interviewId]: interview }));
}
