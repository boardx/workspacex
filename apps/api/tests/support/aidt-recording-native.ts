import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { closeHttpServerDeterministically } from "./close-app";

/** Actual adapter HTTP boundary only. This recorder never contacts a model supplier. */
export async function startAidtRecordingNative() {
  const requests: { method: string; path: string }[] = [];
  const submissions: { threadId: string; runId: string; body: unknown; responseStatus: number }[] = [];
  const threads = new Set<string>(), runs = new Map<string, string>(), threadMessages = new Map<string, unknown[]>();
  const runStatuses = new Map<string, "success" | "interrupted">(), threadStatuses = new Map<string, "idle" | "interrupted">();
  let runResponseStatus = 200, interruptNext = false;
  const respond = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const method = req.method ?? "GET", pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    requests.push({ method, path: pathname });
    if (method === "GET" && pathname === "/healthz") return respond(res, 200, { status: "ok", testTransportOnly: true });
    const stream = /^\/threads\/([^/]+)\/runs\/([^/]+)\/stream$/u.exec(pathname);
    if (method === "GET" && stream && runs.get(stream[2]!) === stream[1]) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(); return; }
    if (method === "POST" && pathname === "/threads") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let input: { thread_id?: unknown };
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof input; }
        catch { return respond(res, 400, { error: "invalid-json" }); }
        const threadId = typeof input.thread_id === "string" && input.thread_id ? input.thread_id : `recording-thread-${randomUUID()}`;
        threads.add(threadId);
        if (!threadMessages.has(threadId)) threadMessages.set(threadId, []);
        return respond(res, 200, { thread_id: threadId });
      });
      return;
    }
    const target = /^\/threads\/([^/]+)(?:\/runs(?:\/([^/]+))?|\/(state))?$/u.exec(pathname);
    const threadId = target?.[1];
    if (!threadId || !threads.has(threadId)) return respond(res, 404, { error: "recording-thread-not-found" });
    if (method === "POST" && pathname === `/threads/${threadId}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return respond(res, 400, { error: "invalid-json" }); }
        const runId = `recording-run-${randomUUID()}`;
        submissions.push({ threadId, runId, body, responseStatus: runResponseStatus });
        if (runResponseStatus < 200 || runResponseStatus >= 300) return respond(res, runResponseStatus, { error: "deliberate-recording-transport-rejection" });
        runs.set(runId, threadId);
        const input = body as { input?: { messages?: unknown } };
        if (Array.isArray(input.input?.messages)) threadMessages.set(threadId, input.input.messages.map(message => {
          const row = message as { role?: string; content?: unknown; id?: string };
          return { ...row, type: row.role === "user" ? "human" : row.role === "assistant" ? "ai" : row.role };
        }));
        // A command/checkpoint continuation retains its earlier messages instead of fabricating a new input.
        const messages = threadMessages.get(threadId)!;
        if ("command" in (body as Record<string, unknown>)) {
          const pending = [...messages].reverse().find(message => Array.isArray((message as { tool_calls?: unknown }).tool_calls)) as { tool_calls?: { id: string }[] } | undefined;
          if (pending?.tool_calls?.[0]) messages.push({ type: "tool", id: `${runId}-confirmation`, tool_call_id: pending.tool_calls[0].id, content: "Synthetic explicit one-task confirmation accepted by the recording transport." });
        }
        if (interruptNext) {
          interruptNext = false; runStatuses.set(runId, "interrupted"); threadStatuses.set(threadId, "interrupted");
          messages.push({ type: "ai", id: `${runId}-intent`, content: "", tool_calls: [{ id: `${runId}-intent-call`, name: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent, args: { understanding: "Synthetic task for the current test group only.", assumptions: ["Synthetic unverified material; no research claim."] } }] });
        } else {
          runStatuses.set(runId, "success"); threadStatuses.set(threadId, "idle");
          messages.push({ type: "ai", id: `${runId}-reply`, content: "Synthetic recording transport reply; no supplier or research was used." });
        }
        return respond(res, runResponseStatus, { run_id: runId });
      });
      return;
    }
    if (method === "GET" && target?.[2] && runs.get(target[2]) === threadId) return respond(res, 200, { status: runStatuses.get(target[2]) });
    if (method === "GET" && target?.[3] === "state") return respond(res, 200, { values: { messages: threadMessages.get(threadId) ?? [] } });
    if (method === "GET" && pathname === `/threads/${threadId}`) return respond(res, 200, { thread_id: threadId, status: threadStatuses.get(threadId) ?? "idle" });
    return respond(res, 404, { error: "recording-route-not-found" });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, requests, submissions, rejectRunWith(status: number) { runResponseStatus = status; }, interruptNextRun() { interruptNext = true; }, resetControls() { runResponseStatus = 200; interruptNext = false; }, close: () => closeHttpServerDeterministically(server), supplierRequests: 0 as const };
}
