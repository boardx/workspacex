import { expect, it } from "vitest";
import { verifyCloudAgentRoundtrip } from "../../scripts/cloud-agent-roundtrip";

const message = { id: "reply", authorKind: "agent", authorId: "agent", agentId: "agent", text: "Ready", clientMessageId: null,
  agentRunId: "run", replyToMessageId: "human", createdAt: "2026-09-11T00:00:00.000Z" };
function fixture(status = "succeeded", reply: unknown = message) {
  const calls: string[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer private-session" });
    const path = new URL(String(url)).pathname; calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/mutate")) return Response.json({ threadId: "thread", version: 1, auditEventId: "audit", impactScope: null });
    if (path.endsWith("/messages") && init?.method === "POST") return Response.json({ message: { ...message, id: "human", authorKind: "human" }, agentRunId: "run", runStatus: "queued" });
    if (path === "/agent-runs/run") return Response.json({ runId: "run", status, resultMessageId: "reply" });
    if (path.endsWith("/messages")) return Response.json({ messages: reply ? [reply] : [], nextCursor: null });
    if (path.endsWith("/cancel")) return new Response(null, { status: 200 });
    if (path === "/chat/threads/thread") return Response.json({ thread: { id: "thread", projectId: null, groupId: null, visibilityScope: "private", phase: "research", archived: false, createdBy: "user", lastActivityAt: "now", version: 2 }, messages: [], rightTabs: [], capabilities: [] });
    throw new Error("unexpected request");
  }) as typeof fetch;
  return { request, calls };
}
const options = () => ({ baseUrl: "https://app.example.com", session: "private-session", signal: new AbortController().signal, agentId: "agent" });
it("accepts only terminal success with the matching durable agent message", async () => {
  const fake = fixture(); const result = await verifyCloudAgentRoundtrip(options(), fake.request);
  expect(result.agentBusinessVerified).toBe(true);
  expect(fake.calls.at(-1)).toBe("POST /chat/threads/mutate");
  expect(fake.calls).not.toContain("POST /agent-runs/run/cancel");
});
it.each([null, { ...message, authorKind: "human" }, { ...message, agentRunId: "different" }, { ...message, text: " " }])("refuses success without a real matching reply", async reply => {
  const fake = fixture("succeeded", reply);
  await expect(verifyCloudAgentRoundtrip(options(), fake.request)).rejects.toThrow("CLOUD_AGENT_MISSING_REPLY");
  expect(fake.calls).toContain("POST /agent-runs/run/cancel");
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
