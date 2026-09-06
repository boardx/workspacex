import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleSessionRequest } from "../src/session/http.js";
import { SessionManager } from "../src/session/manager.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("session HTTP contract", () => {
  it("validates the generated contract, authenticates file access, and fails closed execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wx-http-")); roots.push(dir);
    const manager = new SessionManager({ probe: async () => false, execute: async () => { throw new Error("unexpected"); } }, dir);
    async function request(method: string, url: string, payload?: unknown, token?: string) {
      const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]) as IncomingMessage;
      req.method = method; req.url = url; req.headers = token ? { authorization: `Bearer ${token}` } : {};
      let status = 0; let output: any;
      const res = { writeHead: (code: number) => { status = code; }, end: (body: string) => { output = JSON.parse(body); } } as unknown as ServerResponse;
      await handleSessionRequest(req, res, manager);
      return { status, output };
    }
    expect((await request("POST", "/sessions", { token: "chosen" })).status).toBe(400);
    const created = await request("POST", "/sessions", {});
    expect(created.status).toBe(201);
    const { sessionId, token } = created.output;
    expect((await request("POST", `/sessions/${sessionId}/files`, { path: "/workspace/a", contentBase64: "YQ==" })).status).toBe(404);
    expect((await request("POST", `/sessions/${sessionId}/files`, { path: "/workspace/a", contentBase64: "YQ==" }, token)).status).toBe(200);
    const read = await request("GET", `/sessions/${sessionId}/files?path=/workspace/a`, undefined, token);
    expect(read.output.contentBase64).toBe("YQ==");
    expect((await request("POST", `/sessions/${sessionId}/executions`, { executionId: "11111111-1111-4111-8111-111111111111", command: "python3 -V" }, token)).status).toBe(503);
  });
});
