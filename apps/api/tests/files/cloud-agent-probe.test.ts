import { expect, it } from "vitest";
import { verifyCloudAgentRoundtrip } from "../../scripts/cloud-agent-roundtrip";

const message = { id: "reply", authorKind: "agent", authorId: "agent", agentId: "agent", text: "Ready", clientMessageId: null,
  agentRunId: "run", replyToMessageId: "human", createdAt: "2026-09-11T00:00:00.000Z" };
function fixture(status = "succeeded", reply: unknown = message, cancelStatus = 200) {
  const calls: string[] = [];
  const mutations: { op: string; visibilityScope: string }[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer private-session" });
    const path = new URL(String(url)).pathname; calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/mutate")) {
      const mutation = JSON.parse(String(init?.body)) as { op: string; visibilityScope: string };
      mutations.push(mutation);
      if (mutation.op === "delete") return new Response(null, { status: 500 });
      return Response.json({ threadId: "thread", version: 1, auditEventId: "audit", impactScope: null });
    }
    if (path.endsWith("/messages") && init?.method === "POST") return Response.json({ message: { ...message, id: "human", authorKind: "human" }, agentRunId: "run", runStatus: "queued" });
    if (path === "/agent-runs/run") return Response.json({ runId: "run", status, resultMessageId: "reply" });
    if (path.endsWith("/messages")) return Response.json({ messages: reply ? [reply] : [], nextCursor: null });
    if (path.endsWith("/cancel")) return new Response(null, { status: cancelStatus });
    if (path === "/chat/threads/thread") return Response.json({ thread: { id: "thread", projectId: null, groupId: null, visibilityScope: "private", phase: "research", archived: false, createdBy: "user", lastActivityAt: "now", version: 2 }, messages: [], rightTabs: [], capabilities: [] });
    throw new Error("unexpected request");
  }) as typeof fetch;
  return { request, calls, mutations };
}
const options = () => ({ baseUrl: "https://app.example.com", session: "private-session", signal: new AbortController().signal, agentId: "agent" });
it("accepts only terminal success with the matching durable agent message", async () => {
  const fake = fixture(); const result = await verifyCloudAgentRoundtrip(options(), fake.request);
  expect(result.agentBusinessVerified).toBe(true);
  expect(result).toMatchObject({ threadId: "thread", runId: "run", replyId: "reply", threadRetained: true });
  expect(fake.mutations).toHaveLength(1);
  expect(fake.mutations[0]).toMatchObject({ op: "create", visibilityScope: "private" });
  expect(fake.calls.at(-1)).toBe("GET /chat/threads/thread/messages");
  expect(fake.calls).not.toContain("POST /agent-runs/run/cancel");
});
it.each([null, { ...message, authorKind: "human" }, { ...message, agentRunId: "different" }, { ...message, text: " " }])("refuses success without a real matching reply", async reply => {
  const fake = fixture("succeeded", reply);
  await expect(verifyCloudAgentRoundtrip(options(), fake.request)).rejects.toThrow("CLOUD_AGENT_MISSING_REPLY");
  expect(fake.calls).toContain("POST /agent-runs/run/cancel");
  expect(fake.mutations.map(mutation => mutation.op)).toEqual(["create"]);
});
it("never approves a waiting permission request", async () => {
  const fake = fixture("awaiting_permission");
  await expect(verifyCloudAgentRoundtrip(options(), fake.request)).rejects.toThrow("CLOUD_AGENT_NOT_SUCCESSFUL");
  expect(fake.calls.some(call => call.includes("decision"))).toBe(false);
});
it("does not issue cleanup requests after the shared deadline", async () => {
  const fake = fixture("running"); const controller = new AbortController();
  const request = (async (...args: Parameters<typeof fetch>) => {
    const response = await fake.request(...args);
    if (String(args[0]).endsWith("/agent-runs/run")) controller.abort();
    return response;
  }) as typeof fetch;
  await expect(verifyCloudAgentRoundtrip({ ...options(), signal: controller.signal }, request)).rejects.toThrow();
  expect(fake.calls).not.toContain("POST /agent-runs/run/cancel");
  expect(fake.calls.filter(call => call.endsWith("/mutate"))).toHaveLength(1);
});

it("fails closed when cancellation cannot be confirmed", async () => {
  const fake = fixture("failed", message, 503);
  await expect(verifyCloudAgentRoundtrip(options(), fake.request)).rejects.toThrow("CLOUD_AGENT_CLEANUP_FAILED");
  expect(fake.calls).toContain("POST /agent-runs/run/cancel");
  expect(fake.mutations.map(mutation => mutation.op)).toEqual(["create"]);
});
