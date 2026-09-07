import { createServer, type RequestListener } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sandboxSession as S } from "@repo/contracts";
import { createNativeSessionFiles } from "../../src/infrastructure/agent-run/native-session-files";
import { collectNativeOutputs } from "../../src/application/agent-run/collect-native-outputs";

async function fixture(handler: RequestListener, test: (socketPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "wsx-uds-")); const socketPath = join(dir, "s");
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  try { await test(socketPath); } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}
const sessionId = randomUUID(), token = "a".repeat(64);
it("real UDS GET binds credentials, encodes paths and delivers exact bytes through collector", async () => {
  const bytes = Buffer.from([0, 255, 128, 13, 10]); const path = "/workspace/a &中.png";
  await fixture((req, res) => {
    expect(req.method).toBe("GET"); expect(req.headers.authorization).toBe(`Bearer ${token}`);
    expect(req.url).toBe(`/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`);
    res.end(JSON.stringify({ path, sizeBytes: bytes.length, contentBase64: bytes.toString("base64") }));
  }, async socketPath => {
    const saved = new Map<string, Uint8Array>();
    const result = await collectNativeOutputs({ sessionFiles: createNativeSessionFiles({ socketPath, sessionId, token }),
      objects: { putOnce: async (key, value) => { saved.set(key, value); }, get: async key => saved.get(key) ?? null,
        head: async () => null } }, { runId: "run", paths: [path] });
    expect(Buffer.from(saved.get(result[0]!.objectKey)!)).toEqual(bytes);
  });
});
it.each([302, 400, 404, 410, 500])("rejects status %s without retry or credential leakage", async status => {
  let calls = 0;
  await fixture((_req, res) => { calls++; res.writeHead(status, { Location: "http://invalid/" }); res.end(token); }, async socketPath => {
    await expect(createNativeSessionFiles({ socketPath, sessionId, token }).read("/workspace/a"))
      .rejects.toThrow("native_session_read_failed");
  }); expect(calls).toBe(1);
});
it.each(["invalid", "oversize", "timeout"])("fails bounded %s transport", async mode => {
  await fixture((_req, res) => {
    if (mode === "timeout") return;
    res.end(mode === "invalid" ? "{" : Buffer.alloc(S.limits.maxRequestBytes + 1, 32));
  }, async socketPath => {
    await expect(createNativeSessionFiles({ socketPath, sessionId, token, timeoutMs: 100 }).read("/workspace/a"))
      .rejects.toThrow("native_session_read_failed");
  });
});
