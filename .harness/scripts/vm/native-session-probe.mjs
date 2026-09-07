#!/usr/bin/env node
/**
 * Deployment probe for the sessions-only UDS. It creates and destroys one empty session
 * but never prints its bearer token. The process runs as the same unprivileged user as API.
 */
import { request as httpRequest } from "node:http";

const socketPath = process.env.NATIVE_SESSION_SOCKET;
if (!socketPath?.startsWith("/") || !socketPath.endsWith("/skill-sandbox.sock")) {
  throw new Error("native session probe socket is invalid");
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({
      socketPath,
      method,
      path,
      headers: {
        accept: "application/json",
        ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      timeout: 2_000,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) req.destroy(new Error("native session probe response too large"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { reject(new Error("native session probe returned invalid JSON")); return; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("native session probe timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

let session;
try {
  const health = await request("GET", "/healthz");
  if (health.status !== 200 || health.body?.ok !== true) throw new Error("native session health probe failed");
  const legacy = await request("POST", "/run", { script: "process.stdout.write('must-not-run')" });
  if (legacy.status !== 404) throw new Error("native session service exposed legacy execution");
  const created = await request("POST", "/sessions", {});
  if (created.status !== 201 || typeof created.body?.sessionId !== "string" ||
      !/^[a-f0-9]{64}$/.test(created.body?.token ?? "")) {
    throw new Error("native session create probe failed");
  }
  session = created.body;
  const deleted = await request("DELETE", `/sessions/${session.sessionId}`, undefined, session.token);
  if (deleted.status !== 200) throw new Error("native session delete probe failed");
  session = undefined;
  process.stdout.write("native sessions-only UDS probe passed\n");
} finally {
  if (session !== undefined) {
    try { await request("DELETE", `/sessions/${session.sessionId}`, undefined, session.token); }
    catch { /* deployment fails with the original error; the server TTL bounds residue */ }
  }
}
