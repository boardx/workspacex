import { getStoredSessionToken } from "./api-client";
import type { InterviewMarkdownEnvelope } from "./interview-markdown-api";

export type InterviewGenerationSession = Readonly<{
  step: "outline" | "report";
  status: "running" | "completed" | "failed";
  source?: InterviewMarkdownEnvelope;
  revisionId?: string | null;
  sourceVersion?: number;
  error?: unknown;
  stage?: "context" | "model" | "validation" | "storage";
  markdown?: string;
  previousCandidateMarkdown?: string;
  attempt?: number;
}>;
const sessions = new Map<string, InterviewGenerationSession>();
const listeners = new Set<() => void>();
function sessionKey(id: string) { return `${getStoredSessionToken() ?? "anonymous"}:${id}`; }
export function getInterviewGenerationSession(id: string) { return sessions.get(sessionKey(id)) ?? null; }
export function clearInterviewGenerationSession(id: string, session: InterviewGenerationSession) {
  const key = sessionKey(id);
  if (sessions.get(key) !== session) return;
  sessions.delete(key);
  listeners.forEach(listener => listener());
}
export function subscribeInterviewGeneration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function updateInterviewGeneration(key: string, patch: Partial<InterviewGenerationSession>) {
  const current = sessions.get(key);
  if (!current) return;
  sessions.set(key, { ...current, ...patch });
  listeners.forEach(listener => listener());
}
/** Keep an authorized request alive when its route changes; never restart on subscription. */
export async function runInterviewGeneration(id: string, step: InterviewGenerationSession["step"], operation: (update: (patch: Partial<InterviewGenerationSession>) => void) => Promise<InterviewMarkdownEnvelope>, origin?: { revisionId: string | null; version: number }) {
  const key = sessionKey(id);
  if (sessions.get(key)?.status === "running") throw new Error("GENERATION_ALREADY_RUNNING");
  let active: InterviewGenerationSession = { step, revisionId: origin?.revisionId, sourceVersion: origin?.version, status: "running", stage: "context", markdown: "", attempt: 0 };
  sessions.set(key, active);
  const update = (patch: Partial<InterviewGenerationSession>) => {
    if (sessions.get(key) !== active) return;
    updateInterviewGeneration(key, patch);
    active = sessions.get(key)!;
  };
  listeners.forEach(listener => listener());
  try {
    const source = await operation(update);
    update({ status: "completed", source });
    return source;
  } catch (error) {
    update({ status: "failed", error });
    throw error;
  }
}
