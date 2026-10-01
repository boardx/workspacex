"use client";
import * as React from "react";
import { getAgentPanel } from "@/lib/live-chat";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { loadAgentRunView } from "@/lib/use-agent-run-view";
import { getStoredSessionToken } from "@/lib/api-client";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";

/** Resolve feedback attribution from the persisted result, never the composer selection. */
export function PersistedAgentFeedback({ messageId, projectId = null }: { messageId: string | null; projectId?: string | null }) {
  const runId = React.useContext(MessageRunContext);
  const bearer = getStoredSessionToken();
  const scope = JSON.stringify([runId, messageId, projectId, bearer]);
  const [target, setTarget] = React.useState<{ scope: string; agentId: string; name: string | null } | null>(null);
  React.useEffect(() => {
    if (!messageId || !runId || !bearer) return;
    const controller = new AbortController();
    void (async () => {
      // 与身份行 / 升级留痕共享同一次 run 读（`use-agent-run-view.ts`），不各打一次。
      const run = await loadAgentRunView(runId, bearer);
      if (!run || run.resultMessageId !== messageId || !run.agentId || controller.signal.aborted) return;
      // Thread participants can read this roster without Agent-library admin access.
      const roster = await getAgentPanel(run.threadId, projectId, bearer);
      const agent = roster.agents.find((item) => item.id === run.agentId);
      if (!controller.signal.aborted) setTarget({ scope, agentId: run.agentId, name: agent?.name ?? null });
    })().catch(() => { /* Without authoritative attribution, do not misdirect feedback. */ });
    return () => controller.abort();
  }, [messageId, runId, projectId, bearer, scope]);
  return target?.scope === scope ? <FeedbackButton target={{ kind: "agent", agentId: target.agentId }} targetLabel={target.name} testid="chat-agent-feedback" /> : null;
}
