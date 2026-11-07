import { describe, expect, it } from "vitest";
import { acceptedQueuedTurn, nextTurnRoute, proveCompletedNextTurn, acceptedSdkTurn, type ExpectedNextTurn } from "../e2e/support/hitl-next-turn";

const queueId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const sdkMessageId = "10000000-0000-4000-8000-000000000003";
const text = "current greeting";
const queued = { id: queueId, clientRequestId: requestId, text, agentId: "fixture-agent", status: "dispatched", runId: "current-run", createdAt: "2026-11-03T09:36:36.763Z", error: null };
const expected: ExpectedNextTurn = { threadId: "current-thread", text, runId: "current-run", clientMessageId: queueId, queue: { id: queueId, clientRequestId: requestId, agentId: "fixture-agent" } };
function snapshot() {
  return {
    queueItem: { ...queued },
    run: { agentId: "fixture-agent", runId: "current-run", threadId: "current-thread", inputMessageId: "persisted-human", status: "succeeded", resultMessageId: "persisted-result" },
    messages: { nextCursor: null, messages: [
      { id: "persisted-human", authorKind: "human", authorId: "fixture-user", agentId: null, text, clientMessageId: queueId, agentRunId: "current-run", replyToMessageId: null, createdAt: "2026-11-03T09:36:37.000Z" },
      { id: "persisted-result", authorKind: "agent", authorId: "fixture-agent", agentId: "fixture-agent", text: "reply to current greeting", clientMessageId: null, agentRunId: "current-run", replyToMessageId: "persisted-human", createdAt: "2026-11-03T09:36:40.000Z" },
    ] },
  };
}

describe("next-turn route admission", () => {
  it("observes the supported durable queue instead of requiring a second SDK POST", () => {
    expect(nextTurnRoute("POST", "http://api/chat/threads/current-thread/queued-messages", "current-thread")).toBe("queue");
    expect(nextTurnRoute("POST", "http://web/api/copilotkit/agent/default/run", "current-thread")).toBe("sdk");
  });
  it.each([
    ["GET", "http://api/chat/threads/current-thread/queued-messages"],
    ["POST", "http://api/chat/threads/other-thread/queued-messages"],
    ["POST", "http://web/unrelated/agent/default/run"],
  ])("does not admit %s %s", (method, url) => expect(nextTurnRoute(method, url, "current-thread")).toBeNull());
});

describe("queue acceptance is not completion", () => {
  it("accepts the real 201 receipt while it is pending", () => {
    const pending = { ...queued, status: "pending", runId: null };
    expect(acceptedQueuedTurn(201, pending, text, requestId)).toEqual(pending);
  });
  it.each([
    [500, queued], [200, queued], [201, { ...queued, status: "failed", error: "QUEUE_DELIVERY_REJECTED" }],
    [201, { ...queued, status: "cancelled" }], [201, { ...queued, text: "wrong message" }],
    [201, { ...queued, clientRequestId: sdkMessageId }], [201, { ...queued, id: "" }],
  ])("rejects an unsuccessful or mismatched queue receipt %s", (status, body) => {
    expect(() => acceptedQueuedTurn(status, body, text, requestId)).toThrow();
  });
});

describe("current-message canonical completion", () => {
  it("proves the dispatched queue item, exact succeeded run and uniquely persisted human/reply", () => {
    expect(proveCompletedNextTurn(expected, snapshot())).toEqual({ runId: "current-run", humanMessageId: "persisted-human", resultMessageId: "persisted-result" });
  });
  it("proves direct SDK delivery using its actual client message identity", () => {
    const data = snapshot(); data.messages.messages[0]!.clientMessageId = sdkMessageId;
    expect(proveCompletedNextTurn({ ...expected, queue: undefined, clientMessageId: sdkMessageId }, data)).toEqual({ runId: "current-run", humanMessageId: "persisted-human", resultMessageId: "persisted-result" });
  });
  it.each(["pending", "failed", "cancelled"])("never accepts queue status %s even when an old run succeeded", status => {
    const data = snapshot(); data.queueItem.status = status;
    expect(() => proveCompletedNextTurn(expected, data)).toThrow(/queue/i);
  });
  it("rejects a different dispatched item or execution", () => {
    const data = snapshot(); data.queueItem.runId = "old-run";
    expect(() => proveCompletedNextTurn(expected, data)).toThrow(/queue/i);
  });
  it.each(["running", "failed", "cancelled"])("does not call canonical run status %s completed", status => {
    const data = snapshot(); data.run.status = status;
    expect(() => proveCompletedNextTurn(expected, data)).toThrow(/succeeded/i);
  });
  it.each(["runId", "threadId", "inputMessageId", "resultMessageId"] as const)("rejects a wrong canonical %s", field => {
    const data = snapshot(); data.run[field] = "unrelated";
    expect(() => proveCompletedNextTurn(expected, data)).toThrow();
  });
  it("rejects a duplicate persisted user message", () => {
    const data = snapshot(); data.messages.messages.push({ ...data.messages.messages[0]!, id: "duplicate-human" });
    expect(() => proveCompletedNextTurn(expected, data)).toThrow(/exactly one/i);
  });
  it.each(["clientMessageId", "agentRunId"] as const)("rejects a human row with wrong %s", field => {
    const data = snapshot(); data.messages.messages[0]![field] = sdkMessageId;
    expect(() => proveCompletedNextTurn(expected, data)).toThrow();
  });
  it.each(["replyToMessageId", "agentRunId", "text"] as const)("rejects an unrelated completed reply with wrong %s", field => {
    const data = snapshot(); data.messages.messages[1]![field] = "different-message";
    expect(() => proveCompletedNextTurn(expected, data)).toThrow();
  });
});

const sdkRequest = { threadId: "sdk-session-thread", runId: "sdk-run", tools: [], context: [], forwardedProps: { chatThreadId: "current-thread" }, state: {}, messages: [{ id: sdkMessageId, role: "user", content: text }] };
const sdkStream = 'data: {"type":"CUSTOM","name":"execution_event","value":{"runId":"current-run"}}\n\ndata: {"type":"RUN_FINISHED"}\n\n';
it("takes the canonical execution identity from a finished real SDK stream", () => {
  expect(acceptedSdkTurn(200, sdkStream, sdkRequest, "current-thread", text)).toEqual({ threadId: "current-thread", text, runId: "current-run", clientMessageId: sdkMessageId });
});
it.each([
  [500, sdkStream, sdkRequest], [200, sdkStream, { ...sdkRequest, forwardedProps: { chatThreadId: "other-thread" } }],
  [200, sdkStream, { ...sdkRequest, messages: [{ id: sdkMessageId, role: "user", content: "another message" }] }],
  [200, 'data: {"type":"RUN_FINISHED"}\n', sdkRequest],
  [200, sdkStream.replace('RUN_FINISHED', 'RUN_ERROR'), sdkRequest],
])("rejects unaccepted, uncorrelated or incomplete SDK execution", (status, stream, request) => {
  expect(() => acceptedSdkTurn(status, stream, request, "current-thread", text)).toThrow();
});

it("does not confuse an SDK thread id with the forwarded canonical Chat identity", () => {
  expect(() => acceptedSdkTurn(200, sdkStream, { ...sdkRequest, threadId: "current-thread", forwardedProps: {} }, "current-thread", text)).toThrow();
});
