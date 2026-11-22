import { getThread } from "@/lib/live-chat";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import { readChatAgentRun } from "@/lib/chat-workbench/read-chat-agent-run";

/** A streaming bubble is a preview, not a durable source reference. */
export async function readAidtCandidateReply(input: { projectId: string; threadId: string; prompt: string; replyText: string; sessionToken: string; signal: AbortSignal }) {
  const check = () => input.signal.throwIfAborted();
  check();
  const detail = await getThread(input.threadId, input.projectId, input.sessionToken); check();
  if (detail.thread.id !== input.threadId || detail.thread.projectId !== input.projectId || detail.thread.groupId !== null
    || detail.thread.visibilityScope !== "plenary" || detail.thread.archived) throw new Error("AIDT_CANDIDATE_THREAD_CHANGED");
  const persisted = await readAllPersistedMessages(input.threadId, input.sessionToken); check();
  const humans = persisted.messages.filter(message => message.role === "user" && message.content === input.prompt);
  if (humans.length !== 1 || !humans[0]!.agentRunId) throw new Error("AIDT_CANDIDATE_REQUEST_NOT_PERSISTED");
  const human = humans[0]!;
  const tail = persisted.messages.slice(persisted.messages.indexOf(human) + 1);
  if (tail.some(message => message.role === "user")) throw new Error("AIDT_CANDIDATE_TURN_CHANGED");
  const run = await readChatAgentRun(human.agentRunId!, input.sessionToken, input.signal); check();
  if (run.runId !== human.agentRunId || run.threadId !== input.threadId || run.inputMessageId !== human.id || run.status !== "succeeded" || !run.resultMessageId) throw new Error("AIDT_CANDIDATE_RUN_INCOMPLETE");
  const reply = tail.find(message => message.id === run.resultMessageId && message.role === "assistant" && message.agentRunId === run.runId && message.content === input.replyText);
  if (!reply) throw new Error("AIDT_CANDIDATE_REPLY_CHANGED");
  return { messageId: reply.id, runId: run.runId };
}
