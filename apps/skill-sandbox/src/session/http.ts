import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionManager } from "./manager.js";
import { validateSessionBody, sessionLimits } from "./schema.js";

export async function handleSessionRequest(req: IncomingMessage, res: ServerResponse, manager: SessionManager): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://sandbox.internal");
  if (url.pathname !== "/sessions" && !url.pathname.startsWith("/sessions/")) return false;
  const send = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  try {
    const body = async (schema: string) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > sessionLimits.maxRequestBytes!) throw new Error("INVALID_SESSION_INPUT");
        chunks.push(chunk as Buffer);
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("INVALID_SESSION_INPUT"); }
      if (!validateSessionBody(schema, value)) throw new Error("INVALID_SESSION_INPUT");
      return value;
    };
    if (url.pathname === "/sessions" && req.method === "POST") {
      const input = await body("create") as { skills?: Parameters<SessionManager["create"]>[0]; ttlMs?:number };
      send(201, await manager.create(input.skills, input.ttlMs)); return true;
    }
    const parts = url.pathname.split("/").slice(2);
    const id = parts[0]!;
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? "";
    const path = url.searchParams.get("path");
    if (parts.length === 1 && req.method === "DELETE") send(200, await manager.destroy(id, token));
    else if (parts.length === 2 && parts[1] === "files" && req.method === "POST") {
      send(200, await manager.write(id, token, await body("write") as Parameters<SessionManager["write"]>[2]));
    } else if (parts.length === 2 && ["files", "entries"].includes(parts[1]!) && req.method === "GET") {
      if (!validateSessionBody("read", { path })) throw new Error("INVALID_SESSION_INPUT");
      send(200, parts[1] === "files" ? await manager.read(id, token, path!) : await manager.list(id, token, path!));
    } else if (parts.length === 2 && parts[1] === "executions" && req.method === "POST") {
      const input = await body("execute") as { executionId: string; command: string; timeoutMs?: number };
      send(200, await manager.execute(id, token, { ...input, timeoutMs: input.timeoutMs ?? sessionLimits.defaultTimeoutMs! }));
    } else if (parts.length === 4 && parts[1] === "executions" && parts[3] === "cancel" && req.method === "POST") {
      send(200, manager.cancel(id, token, parts[2]!));
    } else send(404, { error: "NOT_FOUND" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? "SESSION_FILE_NOT_FOUND" : error instanceof Error ? error.message : "SESSION_FAILED";
    const status = code === "SESSION_EXECUTION_UNAVAILABLE" ? 503 : ["SESSION_NOT_FOUND", "SESSION_FILE_NOT_FOUND"].includes(code) ? 404 :
      code === "SESSION_EXPIRED" ? 410 : ["SESSION_BUSY", "SESSION_EXECUTION_CONFLICT", "SESSION_LIMIT"].includes(code) ? 409 :
        code.startsWith("INVALID_") || code === "SESSION_PATH_READ_ONLY" || code === "SESSION_FILE_TOO_LARGE" ? 400 : 500;
    // Never return internal disk paths or OS errors to the caller.
    send(status, { error: status === 500 ? "SESSION_FAILED" : code });
  }
  return true;
}
