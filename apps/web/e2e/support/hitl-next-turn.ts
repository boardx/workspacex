/** Strict test-only evidence for both supported next-turn transports after HITL. */
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { QueuedMessage, operations as queueOperations } from "@repo/contracts/thread-message-queue";
import { AgentRunView, operations as runOperations } from "@repo/contracts/wave2-runtime";
import { operations as chatOperations } from "@repo/contracts/chat";
import { sessionHeaders } from "./authoritative-thread";

const RunProof = AgentRunView.pick({ runId: true, threadId: true, agentId: true, inputMessageId: true, status: true, resultMessageId: true }).strip();
export type ExpectedNextTurn = { threadId: string; text: string; runId: string; clientMessageId: string; queue?: { id: string; clientRequestId: string; agentId: string } };

export function nextTurnRoute(method: string, url: string, threadId: string): "sdk" | "queue" | null {
  if (method !== "POST") return null;
  const path = new URL(url).pathname;
  if (path === "/api/copilotkit/agent/default/run") return "sdk";
  return path === queueOperations.enqueue.path.replace(":threadId", encodeURIComponent(threadId)) ? "queue" : null;
}

export function acceptedQueuedTurn(status: number, body: unknown, text: string, clientRequestId: string): QueuedMessage {
  assert.equal(status, 201, "queue acceptance must return 201");
  const item = QueuedMessage.parse(body);
  assert.equal(item.text, text, "queue must accept this exact text");
  assert.equal(item.clientRequestId, clientRequestId, "queue must retain this request identity");
  assert(item.agentId.trim(), "queue must resolve an agent");
  assert(["pending", "dispatched"].includes(item.status), "queue acceptance must not fail or cancel");
  assert.equal(item.error, null, "queue acceptance must have no error");
  return item;
}

export function acceptedSdkTurn(status: number, stream: string, request: unknown, threadId: string, text: string): ExpectedNextTurn {
  assert.equal(status, 200, "SDK run must return 200");
  const input = request as { threadId: string; forwardedProps?: { chatThreadId?: unknown }; messages: Array<{ id: string; role: string; content: string }> };
  assert(input.threadId, "SDK must carry its session thread identity");
  assert.equal(input.forwardedProps?.chatThreadId, threadId, "SDK must forward this canonical Chat thread");
  const human = [...input.messages].reverse().find(message => message.role === "user");
  assert.equal(human?.content, text, "SDK must send this exact text");
  assert(human?.id, "SDK must carry the real client message identity");
  const events = stream.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5).trim()));
  assert(!events.some(event => event.type === "RUN_ERROR"), "SDK run must not report RUN_ERROR");
  assert.equal(events.at(-1)?.type, "RUN_FINISHED", "SDK stream must finish");
  const ids = [...new Set(events.filter(event => event.type === "CUSTOM" && event.name === "execution_event")
    .map(event => event.value?.runId).filter((id): id is string => typeof id === "string" && id.length > 0))];
  assert.equal(ids.length, 1, "SDK must identify exactly one canonical run");
  return { threadId, text, clientMessageId: human.id, runId: ids[0]! };
}

export function proveCompletedNextTurn(expected: ExpectedNextTurn, snapshot: { run: unknown; messages: unknown; queueItem?: unknown }) {
  const run = RunProof.parse(snapshot.run);
  assert.equal(run.runId, expected.runId, "canonical run identity must match");
  assert.equal(run.threadId, expected.threadId, "canonical thread must match");
  assert.equal(run.status, "succeeded", "canonical run must be succeeded");
  assert(run.inputMessageId && run.resultMessageId, "canonical input/result identities must exist");
  if (expected.queue) {
    const item = QueuedMessage.parse(snapshot.queueItem);
    assert.equal(item.status, "dispatched", "queue must be dispatched");
    assert.equal(item.error, null, "queue must not have an error");
    assert.equal(item.id, expected.queue.id, "queue item identity must match");
    assert.equal(item.clientRequestId, expected.queue.clientRequestId, "queue request identity must match");
    assert.equal(item.agentId, expected.queue.agentId, "queue agent must match");
    assert.equal(run.agentId, item.agentId, "canonical queue execution agent must match");
    assert.equal(item.runId, run.runId, "queue execution must match");
    assert.equal(item.text, expected.text, "queue text must match");
    assert.equal(expected.clientMessageId, item.id, "dispatched queue row is the canonical client message identity");
  }
  const messages = chatOperations.listMessages.out.parse(snapshot.messages).messages;
  const humans = messages.filter(message => message.authorKind === "human" && message.text === expected.text);
  assert.equal(humans.length, 1, "exactly one persisted human must match current text");
  const human = humans[0]!;
  assert.equal(human.id, run.inputMessageId, "canonical input must be current human message");
  assert.equal(human.clientMessageId, expected.clientMessageId, "persisted client message identity must match");
  assert.equal(human.agentRunId, run.runId, "human run must match");
  const results = messages.filter(message => message.id === run.resultMessageId);
  assert.equal(results.length, 1, "exactly one canonical result must exist");
  const result = results[0]!;
  assert.equal(result.authorKind, "agent", "result must be an assistant message");
  assert.equal(result.agentRunId, run.runId, "result run must match");
  assert.equal(result.replyToMessageId, human.id, "result must reply to this human message");
  assert(result.text.includes(expected.text), "reply must contain current text echoed by the loopback");
  return { runId: run.runId, humanMessageId: human.id, resultMessageId: result.id };
}

/** Do not infer success from an optimistic user bubble or a queue 201 alone. */
export async function sendAndProveNextTurn(page: Page, threadId: string, text: string, options: {
  action?: "send" | "queue";
  afterQueueAccepted?: (receipt: QueuedMessage) => Promise<void>;
} = {}) {
  const accepted = page.waitForResponse(response => nextTurnRoute(response.request().method(), response.url(), threadId) !== null);
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId(options.action === "queue" ? "workbench-queue-next-turn" : "copilotkit-v2-send").click();
  const response = await accepted;
  const route = nextTurnRoute(response.request().method(), response.url(), threadId);
  if (options.action === "queue") assert.equal(route, "queue", "explicit queue action must use the durable queue");
  const headers = await sessionHeaders(page);
  let expected: ExpectedNextTurn;
  let queueItem: QueuedMessage | undefined;
  if (route === "queue") {
    const input = queueOperations.enqueue.in.parse(response.request().postDataJSON());
    const receipt = acceptedQueuedTurn(response.status(), await response.json(), text, input.clientRequestId);
    assert.equal(input.text, text, "queue POST must carry current text");
    await options.afterQueueAccepted?.(receipt);
    const path = queueOperations.list.path.replace(":threadId", encodeURIComponent(threadId));
    await expect.poll(async () => {
      const read = await page.request.get(path, { headers, timeout: 10_000 });
      expect(read.status()).toBe(200);
      queueItem = queueOperations.list.out.parse(await read.json()).items.find(item => item.id === receipt.id);
      return queueItem?.status === "dispatched" && queueItem.runId ? "dispatched" : queueItem?.status ?? "missing";
    }, { timeout: 30_000 }).toBe("dispatched");
    assert(queueItem?.runId, "real queue dispatch must supply a run identity");
    expected = { threadId, text, runId: queueItem.runId, clientMessageId: receipt.id,
      queue: { id: receipt.id, clientRequestId: receipt.clientRequestId, agentId: receipt.agentId } };
  } else {
    assert.equal(route, "sdk");
    expected = acceptedSdkTurn(response.status(), await response.text(), response.request().postDataJSON(), threadId, text);
  }
  const runPath = runOperations.getAgentRun.path.replace(":runId", encodeURIComponent(expected.runId));
  let run: unknown;
  await expect.poll(async () => {
    const read = await page.request.get(runPath, { headers, timeout: 10_000 });
    expect(read.status()).toBe(200);
    run = await read.json();
    return RunProof.parse(run).status;
  }, { timeout: 60_000 }).toBe("succeeded");
  const messagePath = chatOperations.listMessages.path.replace(":threadId", encodeURIComponent(threadId));
  const stored = await page.request.get(`${messagePath}?limit=100`, { headers, timeout: 10_000 });
  expect(stored.status()).toBe(200);
  const result = proveCompletedNextTurn(expected, { run, messages: await stored.json(), queueItem });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text);
  console.log(`[hitl-next-turn] route=${route} persistedHuman=${result.humanMessageId} run=${result.runId} result=${result.resultMessageId}`);
  return result;
}
