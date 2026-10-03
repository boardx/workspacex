import { getStoredSessionToken } from "./api-client";
import type { InterviewMarkdownEnvelope } from "./interview-markdown-api";

export type InterviewGenerationSession = Readonly<{
  step: "outline" | "report";
  status: "running" | "completed" | "failed";
  source?: InterviewMarkdownEnvelope;
  error?: unknown;
  stage?: "context" | "model" | "validation" | "storage";
  markdown?: string;
  attempt?: number;
}>;
const sessions = new Map<string, InterviewGenerationSession>();
const listeners = new Set<() => void>();
function sessionKey(id: string) { return `${getStoredSessionToken() ?? "anonymous"}:${id}`; }
export function getInterviewGenerationSession(id: string) { return sessions.get(sessionKey(id)) ?? null; }
export function subscribeInterviewGeneration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function updateInterviewGeneration(key: string, patch: Partial<InterviewGenerationSession>) {
  const current = sessions.get(key);
  if (!current) return;
  sessions.set(key, { ...current, ...patch });
  listeners.forEach(listener => listener());
}
/** Keep an authorized request alive when its route changes; never restart on subscription. */
export async function runInterviewGeneration(id: string, step: InterviewGenerationSession["step"], operation: (update: (patch: Partial<InterviewGenerationSession>) => void) => Promise<InterviewMarkdownEnvelope>) {
  const key = sessionKey(id);
  if (sessions.get(key)?.status === "running") throw new Error("GENERATION_ALREADY_RUNNING");
  sessions.set(key, { step, status: "running", stage: "context", markdown: "", attempt: 0 });
  listeners.forEach(listener => listener());
  try {
    const source = await operation(patch => updateInterviewGeneration(key, patch));
    updateInterviewGeneration(key, { status: "completed", source });
    return source;
  } catch (error) {
    updateInterviewGeneration(key, { status: "failed", error });
    throw error;
  }
}
