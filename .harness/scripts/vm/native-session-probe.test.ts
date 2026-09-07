import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PROBE = resolve(import.meta.dirname, "native-session-probe.mjs");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

async function runProbe(legacyStatus = 404) {
  const temp = mkdtempSync(join(tmpdir(), "native-session-probe-"));
  temps.push(temp);
  const socket = join(temp, "skill-sandbox.sock");
  const token = "d".repeat(64);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } else if (req.url === "/run") {
      res.writeHead(legacyStatus, { "content-type": "application/json" });
      res.end('{"error":"not found"}');
    } else if (req.method === "POST" && req.url === "/sessions") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "session-1", token, expiresAt: Date.now() + 60_000 }));
    } else if (req.method === "DELETE" && req.url === "/sessions/session-1" &&
               req.headers.authorization === `Bearer ${token}`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"deleted":true}');
    } else {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"unexpected"}');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveChild) => {
    const child = spawn(process.execPath, [PROBE], {
      env: { ...process.env, NATIVE_SESSION_SOCKET: socket },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => resolveChild({ code, stdout, stderr }));
  });
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return { ...result, requests, token };
}

describe("#2929 native sessions-only deployment probe", () => {
  it("checks health, rejects legacy execution, creates and destroys one session without logging its token", async () => {
    const result = await runProbe();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("sessions-only UDS probe passed");
    expect(result.requests).toEqual([
      "GET /healthz",
      "POST /run",
      "POST /sessions",
      "DELETE /sessions/session-1",
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(result.token);
  });

  it("fails when the dedicated service exposes legacy /run", async () => {
    const result = await runProbe(200);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("exposed legacy execution");
    expect(`${result.stdout}${result.stderr}`).not.toContain(result.token);
  });
});
