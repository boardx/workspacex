"use client";

import * as React from "react";
import { generateFollowUpSuggestions } from "@/lib/live-chat";
import { readChatAgentRun } from "./read-chat-agent-run";

export function useFollowUpSuggestions(
  threadId: string | null,
  completedRunId: string | null,
  sessionToken: string | undefined,
) {
  const request = React.useRef<{ key: string; pending: Promise<readonly string[]> } | null>(null);
  const [resolved, setResolved] = React.useState<{ key: string; texts: readonly string[] } | null>(null);
  const key = threadId && completedRunId && sessionToken ? JSON.stringify([threadId, completedRunId]) : null;

  const activeKey = React.useRef(key);
  activeKey.current = key;

  React.useEffect(() => {
    if (!key || !threadId || !completedRunId || !sessionToken) return;
    activeKey.current = key;
    if (request.current?.key !== key) {
      const pending = readChatAgentRun(completedRunId, sessionToken)
        .then(run => {
          if (run.status !== "succeeded" || run.threadId !== threadId || !run.resultMessageId) return [];
          if (activeKey.current !== key) return [];
          return generateFollowUpSuggestions(threadId, run.agentId, sessionToken, { notifyCredit: false })
            .then(result => result.suggestions);
        })
        .catch(() => []);
      request.current = { key, pending };
    }
    let current = true;
    void request.current.pending.then(texts => {
      if (current) setResolved({ key, texts });
    });
    return () => {
      current = false;
      if (activeKey.current === key) activeKey.current = null;
    };
  }, [key, threadId, completedRunId, sessionToken]);

  return { texts: resolved?.key === key ? resolved.texts : [], loading: key !== null && resolved?.key !== key };
}
