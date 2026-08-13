import type { z } from "zod";
import { interview } from "@repo/contracts";

type Draft = z.infer<typeof interview.DigitalInterview>;
const STORAGE_KEY = "wsx.mockDigitalInterviewDrafts.v1";

export function createMockDigitalInterviewDraft(input: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
}): Draft {
  if (typeof window === "undefined") throw new Error("MOCK_BROWSER_REQUIRED");
  const draft: Draft = {
    interviewId: `mock-batch-${crypto.randomUUID()}`,
    name: input.name.trim(),
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    topic: input.topic.trim(),
    status: "draft",
    sourceQuickInterviewId: null,
    selectedExpertIds: [],
    reportId: null,
    version: 1,
  };
  write(draft);
  return draft;
}

export function loadMockDigitalInterviewDraft(interviewId: string): Draft | null {
  if (!interviewId.startsWith("mock-batch-") || typeof window === "undefined") return null;
  return readAll()[interviewId] ?? null;
}

function readAll(): Record<string, Draft> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, Draft>; } catch { return {}; }
}

function write(draft: Draft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [draft.interviewId]: draft }));
}
