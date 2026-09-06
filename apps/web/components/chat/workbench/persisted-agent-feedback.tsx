"use client";
import * as React from "react";
import { agentRuntime } from "@repo/contracts";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { getAgentRun } from "@/lib/agent-run";
import { apiRequest, getStoredSessionToken } from "@/lib/api-client";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";

/** Resolve feedback attribution from the persisted result, never the composer selection. */
export function PersistedAgentFeedback({ messageId }: { messageId: string | null }) {
  const runId = React.useContext(MessageRunContext);
  const bearer = getStoredSessionToken();
  const scope = JSON.stringify([runId, messageId, bearer]);
  const [target, setTarget] = React.useState<{ scope: string; agentId: string; name: string } | null>(null);
  React.useEffect(() => {
    if (!messageId || !runId || !bearer) return;
    const controller = new AbortController();
    void (async () => {
      const run = await getAgentRun(runId, bearer, controller.signal);
      if (run.resultMessageId !== messageId || !run.agentId || controller.signal.aborted) return;
      const agents = agentRuntime.operations.listAgents.out.parse(await apiRequest(agentRuntime.operations.listAgents.path, { sessionToken: bearer, signal: controller.signal }));
      const agent = agents.find((item) => item.agentId === run.agentId);
      if (agent && !controller.signal.aborted) setTarget({ scope, agentId: agent.agentId, name: agent.name });
    })().catch(() => { /* Without authoritative attribution, do not misdirect feedback. */ });
    return () => controller.abort();
  }, [messageId, runId, bearer, scope]);
  return target?.scope === scope ? <FeedbackButton target={{ kind: "agent", agentId: target.agentId }} targetLabel={target.name} testid="chat-agent-feedback" /> : null;
}
