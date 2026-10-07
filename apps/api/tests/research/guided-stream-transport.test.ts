import { createServer, request } from "node:http";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { once } from "node:events";
import { expect, it } from "vitest";
import { createResearchStreamWriter, researchStreamEncoding } from "../../src/interface/controllers/guided-research-stream-transport";

it.each([
  [undefined, undefined], ["", undefined], ["gzip, deflate, br", "br"],
  ["br;q=0, gzip;q=0.8", "gzip"], ["gzip;q=1, br;q=0.5", "gzip"],
  ["br;q=0, gzip;q=0, *;q=1", undefined], ["*;q=0.5", "br"],
  ["BR;Q=1, gzip;q=0", "br"], ["br;q=invalid", undefined],
] as const)("negotiates %s without compressing excluded encodings", (header, expected) => {
  expect(researchStreamEncoding(header)).toBe(expected);
});

it.each(["br", "gzip", "identity"] as const)("flushes %s events before execution ends and preserves exact Unicode payload", async encoding => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const frame = `data: ${JSON.stringify({ text: "完整来源正文及历史证据".repeat(1200) })}\n\n`;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    const writer = createResearchStreamWriter(req, res as never);
    res.flushHeaders();
    writer.write(frame);
    await gate;
    writer.write(": keepalive\n\n");
    writer.write(frame);
    await writer.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const req = request({ host: "127.0.0.1", port, headers: { "Accept-Encoding": encoding } });
    req.end();
    const [res] = await once(req, "response");
    expect(res.headers["content-encoding"]).toBe(encoding === "identity" ? undefined : encoding);
    expect(res.headers.vary).toContain("Accept-Encoding");
    let bytes = 0;
    res.on("data", (chunk: Buffer) => { bytes += chunk.length; });
    const decoded = encoding === "br" ? res.pipe(createBrotliDecompress()) : encoding === "gzip" ? res.pipe(createGunzip()) : res;
    const chunks: Buffer[] = [];
    let firstFrame!: () => void;
    const delivered = new Promise<void>(resolve => { firstFrame = resolve; });
    decoded.on("data", (chunk: Buffer) => { chunks.push(chunk); if (Buffer.concat(chunks).length >= Buffer.byteLength(frame)) firstFrame(); });
    await delivered;
    expect(Buffer.concat(chunks).toString()).toBe(frame);
    finish();
    await once(decoded, "end");
    expect(Buffer.concat(chunks).toString()).toBe(frame + ": keepalive\n\n" + frame);
    if (encoding !== "identity") expect(bytes).toBeLessThan(Buffer.byteLength(frame) / 10);
  } finally {
    finish();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 5000);

it("bounds queued plaintext and releases an overloaded observer", async () => {
  const { Writable } = await import("node:stream");
  const response = Object.assign(new Writable({ write(_chunk, _encoding, _done) {} }), {
    setHeader() {}, getHeader() {}, removeHeader() {},
  });
  const writer = createResearchStreamWriter({ headers: { "accept-encoding": "br" } }, response as never);
  writer.write("x".repeat(16 * 1048576 + 1));
  await writer.end();
  expect(response.destroyed).toBe(true);
});

it("bounds terminal drain without timing out research execution", async () => {
  const { Writable } = await import("node:stream");
  const { randomBytes } = await import("node:crypto");
  const { vi } = await import("vitest");
  const response = Object.assign(new Writable({ write(_chunk, _encoding, _done) { this.emit("blocked"); } }), {
    setHeader() {}, getHeader() {}, removeHeader() {},
  });
  const writer = createResearchStreamWriter({ headers: { "accept-encoding": "gzip" } }, response as never);
  const blocked = once(response, "blocked");
  writer.write(`data: ${randomBytes(256 * 1024).toString("base64")}\n\n`);
  await blocked;
  vi.useFakeTimers();
  try {
    const ended = writer.end();
    await vi.advanceTimersByTimeAsync(5000);
    await ended;
    expect(response.destroyed).toBe(true);
  } finally { vi.useRealTimers(); response.destroy(); }
});

it("releases compression after client disconnect while allowing durable work to continue", async () => {
  const { Writable } = await import("node:stream");
  const response = Object.assign(new Writable({ write(_chunk, _encoding, done) { done(); } }), {
    setHeader() {}, getHeader() {}, removeHeader() {},
  });
  const writer = createResearchStreamWriter({ headers: { "accept-encoding": "br" } }, response as never);
  writer.write("data: progress\n\n");
  response.destroy();
  await once(response, "close");
  writer.write("data: persisted result\n\n");
  await writer.end();
  expect(response.listenerCount("close")).toBe(0);
});

it.each(["br", "gzip", "identity"] as const)("preserves a multi-MB %s frame and its trailing terminal event under backpressure", async encoding => {
  const { randomBytes, createHash } = await import("node:crypto");
  const first = `data: ${randomBytes(2 * 1048576).toString("base64")}\n\n`;
  const last = 'data: {"type":"result"}\n\n';
  const server = createServer(async (req, res) => {
    const writer = createResearchStreamWriter(req, res as never);
    res.flushHeaders(); writer.write(first); writer.write(last); await writer.end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const req = request({ host: "127.0.0.1", port: (server.address() as { port: number }).port, headers: { "Accept-Encoding": encoding } });
    req.end(); const [res] = await once(req, "response");
    const decoded = encoding === "br" ? res.pipe(createBrotliDecompress()) : encoding === "gzip" ? res.pipe(createGunzip()) : res;
    const hash = createHash("sha256"); decoded.on("data", (chunk: Buffer) => { hash.update(chunk); });
    await once(decoded, "end");
    expect(hash.digest("hex")).toBe(createHash("sha256").update(first + last).digest("hex"));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 5000);
