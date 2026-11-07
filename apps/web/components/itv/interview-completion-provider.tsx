"use client";
import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { InterviewSessionProvider } from "./interview-session-provider";

export type InterviewCompletion = { interviewId: string; version: number; steps: readonly string[] };
export const InterviewCompletionContext = React.createContext<{
  value: InterviewCompletion | null;
  update: (value: InterviewCompletion) => void;
} | null>(null);

/** Route-local presentation state. Never persisted or shared between sessions. */
export function InterviewCompletionProvider({ children }: { children: React.ReactNode }) {
  const session = useOptionalSession();
  const scope = { status: session?.status, actor: session?.session?.userId, org: session?.session?.currentOrgId, token: session?.session?.sessionToken };
  const previous = React.useRef({ ...scope, epoch: 0 });
  if (scope.status !== previous.current.status || scope.actor !== previous.current.actor || scope.org !== previous.current.org || scope.token !== previous.current.token) {
    previous.current = { ...scope, epoch: previous.current.epoch + 1 };
  }
  return <CompletionState key={previous.current.epoch}><InterviewSessionProvider>{children}</InterviewSessionProvider></CompletionState>;
}
function CompletionState({ children }: { children: React.ReactNode }) {
  const [value, update] = React.useState<InterviewCompletion | null>(null);
  const context = React.useMemo(() => ({ value, update }), [value]);
  return <InterviewCompletionContext.Provider value={context}>{children}</InterviewCompletionContext.Provider>;
}
