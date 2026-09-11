import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chat } from "@repo/contracts";

async function json(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("CLOUD_AGENT_HTTP_FAILED");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 1_048_576) throw new Error("CLOUD_AGENT_RESPONSE_LIMIT");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); }
}

/** Calls real application chat/run routes. Never approves a permission request.
 * A successful HTTP enqueue is insufficient: require a terminal success and its durable reply.
 */
export async function verifyCloudAgentRoundtrip(options: {
  baseUrl: string; session: string; signal: AbortSignal; agentId: string;
}, request: typeof fetch = fetch) {
  options.signal.throwIfAborted();
  const base = new URL(options.baseUrl);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || !options.session || !options.agentId) throw new Error("INVALID_AGENT_PROBE_CONFIGURATION");
  const call = (path: string, init: RequestInit = {}) => request(`${base.href.replace(/\/$/, "")}${path}`, {
    ...init, signal: options.signal, redirect: "error", headers: { Authorization: `Bearer ${options.session}`, ...init.headers },
  });
  const mutate = async (input: unknown) => chat.operations.mutateThread.out.parse(await json(await call(chat.operations.mutateThread.path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chat.operations.mutateThread.in.parse(input)),
  })));
  const common = { projectId: null, groupId: null, visibilityScope: "private", reason: null };
  const created = await mutate({ ...common, op: "create", threadId: null, title: `Provision Agent probe ${randomUUID()}`, expectedVersion: null });
  let runId: string | undefined;
  let succeeded = false;
  try {
    const body = chat.operations.createMessage.in.parse({ threadId: created.threadId, clientMessageId: randomUUID(),
      text: "This is a deployment test. Reply with a short acknowledgement. Do not call external tools or modify any data.", agentId: options.agentId });
    const { threadId: _thread, ...payload } = body;
    const accepted = chat.operations.createMessage.out.parse(await json(await call(`/chat/threads/${encodeURIComponent(created.threadId)}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    })));
    runId = accepted.agentRunId;
    for (;;) {
      options.signal.throwIfAborted();
      const value = await json(await call(`/agent-runs/${encodeURIComponent(runId)}`));
      if (!value || typeof value !== "object" || !("status" in value) || !("runId" in value) || value.runId !== runId) throw new Error("CLOUD_AGENT_INVALID_RUN");
      if (value.status === "succeeded") {
        if (!("resultMessageId" in value) || typeof value.resultMessageId !== "string" || !value.resultMessageId) throw new Error("CLOUD_AGENT_MISSING_REPLY");
        const messages = chat.operations.listMessages.out.parse(await json(await call(`/chat/threads/${encodeURIComponent(created.threadId)}/messages?limit=100`)));
        const reply = messages.messages.find(message => message.id === value.resultMessageId);
        if (!reply || reply.authorKind !== "agent" || reply.agentRunId !== runId || !reply.text.trim()) throw new Error("CLOUD_AGENT_MISSING_REPLY");
        succeeded = true;
        return { agentBusinessVerified: true, runId, replyId: reply.id, threadId: created.threadId } as const;
      }
      if (value.status !== "queued" && value.status !== "running") throw new Error("CLOUD_AGENT_NOT_SUCCESSFUL");
      await delay(500, undefined, { signal: options.signal });
    }
  } finally {
    // No cleanup requests after the shared deadline. A cancelled probe may leave its
    // private thread/run for existing recovery; this does not prove remote termination.
    if (!options.signal.aborted) {
      if (runId && !succeeded) {
        const cancel = await call(`/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
        await cancel.body?.cancel();
        if (!cancel.ok && cancel.status !== 409) throw new Error("CLOUD_AGENT_CLEANUP_FAILED");
      }
      const current = chat.operations.getThread.out.parse(await json(await call(`/chat/threads/${encodeURIComponent(created.threadId)}`)));
      await mutate({ ...common, op: "delete", threadId: created.threadId, title: null,
        expectedVersion: current.thread.version, reason: "Provision Agent probe finished" });
    }
  }
}
