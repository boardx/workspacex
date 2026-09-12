import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpsRequest, type Server } from "node:https";
import { createServer as createTcpServer, type Socket } from "node:net";
import { X509Certificate } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyTlsPreflight } from "../src/tls-preflight";

let directory: string;
let certificatePem: string, privateKeyPem: string, otherCert: string, otherKey: string;
let server: Server, otherServer: Server;
let url: string, otherUrl: string;
let responseStatus = 404;
const context = (budget = 2000) => ({ signal: new AbortController().signal, remainingMs: () => budget });
const secret = (certificate = certificatePem, key = privateKeyPem) => ({ TLS_TEST_SECRET: JSON.stringify({ certificatePem: certificate, privateKeyPem: key }) });
const environment = (publicUrl = url) => ({ publicUrl, tlsSecretRef: "env:TLS_TEST_SECRET" });
// Trust only the ephemeral test certificate. Production uses the untouched platform roots.
const trustedRequest = ((...args: Parameters<typeof httpsRequest>) => {
  const [target, options, listener] = args as [URL, import("node:https").RequestOptions, Parameters<typeof httpsRequest>[2]];
  return httpsRequest(target, { ...options, ca: [certificatePem, otherCert] }, listener);
}) as typeof httpsRequest;
const noRequest = vi.fn(() => { throw new Error("must not connect"); }) as unknown as typeof httpsRequest;
async function listen(s: Server) {
  await new Promise<void>(resolve => s.listen(0, "127.0.0.1", resolve));
  const address = s.address(); if (!address || typeof address === "string") throw new Error();
  return `https://localhost:${address.port}`;
}
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "wsx-tls-preflight-"));
  const make = (name: string) => {
    const cert = join(directory, `${name}.pem`), key = join(directory, `${name}.key`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${name}`,
      "-addext", "subjectAltName=DNS:localhost", "-keyout", key, "-out", cert], { stdio: "ignore" });
    return [readFileSync(cert, "utf8"), readFileSync(key, "utf8")];
  };
  [certificatePem, privateKeyPem] = make("leaf") as [string, string];
  [otherCert, otherKey] = make("other") as [string, string];
  server = createServer({ cert: certificatePem, key: privateKeyPem }, (_req, res) => { res.writeHead(responseStatus); res.end(); });
  otherServer = createServer({ cert: otherCert, key: otherKey }, (_req, res) => { res.writeHead(200); res.end(); });
  url = await listen(server); otherUrl = await listen(otherServer);
});
afterAll(async () => {
  vi.useRealTimers();
  await Promise.all([server, otherServer].filter(Boolean).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
  if (directory) rmSync(directory, { recursive: true, force: true });
});
describe("TLS initialization preflight", () => {
  it("proves key, SAN, current validity and exact live HTTPS leaf using real TLS", async () => {
    const result = await verifyTlsPreflight(environment(), context(), secret(), trustedRequest);
    expect(result).toMatchObject({ tlsVerified: true, hostnameMatched: true, privateKeyMatched: true,
      leafFingerprintSha256: new X509Certificate(certificatePem).fingerprint256 });
    expect(JSON.stringify(result)).not.toContain(privateKeyPem);
  });
  it("routes to the constrained target IP while preserving URL hostname for TLS SNI and Host", async () => {
    const seen: { hostname?: string; lookup?: unknown } = {};
    const routedRequest = ((target: URL, options: import("node:https").RequestOptions, listener: Parameters<typeof httpsRequest>[2]) => {
      seen.hostname = target.hostname;
      seen.lookup = options.lookup;
      return trustedRequest(target, options, listener);
    }) as typeof httpsRequest;
    const result = await verifyTlsPreflight({ ...environment(), preflightTargetIp: "127.0.0.1" }, context(), secret(), routedRequest);
    expect(result.tlsVerified).toBe(true);
    expect(seen.hostname).toBe("localhost");
    expect(seen.lookup).toBeTypeOf("function");
    const routed = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      (seen.lookup as Function)("ignored.example", { all: false }, (error: Error | null, address: string, family: number) =>
        error ? reject(error) : resolve({ address, family }));
    });
    expect(routed).toEqual({ address: "127.0.0.1", family: 4 });
  });
  it.each([302, 503])("rejects a redirect or unhealthy HTTPS response (%i)", async status => {
    responseStatus = status;
    try { await expect(verifyTlsPreflight(environment(), context(), secret(), trustedRequest)).rejects.toThrow("TLS_ENDPOINT_UNVERIFIED"); }
    finally { responseStatus = 404; }
  });
  it("sanitizes unexpected transport errors", async () => {
    const throws = (() => { throw new Error(privateKeyPem); }) as typeof httpsRequest;
    await expect(verifyTlsPreflight(environment(), context(), secret(), throws)).rejects.toThrow(/^TLS_ENDPOINT_UNVERIFIED$/);
  });
  it("rejects a different live certificate even when both leaves are trusted for the host", async () => {
    await expect(verifyTlsPreflight(environment(otherUrl), context(), secret(), trustedRequest)).rejects.toThrow("TLS_ENDPOINT_CERTIFICATE_MISMATCH");
  });
  it("does not disable CA verification for the configured certificate", async () => {
    await expect(verifyTlsPreflight(environment(), context(), secret())).rejects.toThrow("TLS_ENDPOINT_UNVERIFIED");
  });
  it("rejects a mismatched private key before network I/O", async () => {
    await expect(verifyTlsPreflight(environment(), context(), secret(certificatePem, otherKey), noRequest)).rejects.toThrow("TLS_PRIVATE_KEY_MISMATCH");
  });
  it("rejects wrong hostname before network I/O", async () => {
    await expect(verifyTlsPreflight(environment("https://wrong.example"), context(), secret(), noRequest)).rejects.toThrow("TLS_HOSTNAME_MISMATCH");
  });
  it.each(["past", "future"])("rejects certificate validity outside the current interval (%s)", async direction => {
    const cert = new X509Certificate(certificatePem);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(direction === "past" ? Date.parse(cert.validFrom) - 1000 : Date.parse(cert.validTo) + 1000);
    try { await expect(verifyTlsPreflight(environment(), context(), secret(), noRequest)).rejects.toThrow("TLS_CERTIFICATE_NOT_CURRENT"); }
    finally { vi.useRealTimers(); }
  });
  it.each(["not-json", JSON.stringify({ certificatePem: "private marker", privateKeyPem: "secret marker" })])("scrubs invalid secret/parser errors", async value => {
    await expect(verifyTlsPreflight(environment(), context(), { TLS_TEST_SECRET: value }, noRequest)).rejects.toThrow(/^TLS_SECRET_INVALID$/);
  });
  it("honors an already-aborted shared signal and depleted budget without I/O", async () => {
    await expect(verifyTlsPreflight(environment(), { signal: AbortSignal.abort(), remainingMs: () => 1000 }, secret(), noRequest)).rejects.toThrow("TLS_PREFLIGHT_CANCELLED");
    await expect(verifyTlsPreflight(environment(), context(0), secret(), noRequest)).rejects.toThrow("TLS_PREFLIGHT_CANCELLED");
  });
  it.each(["signal", "budget"])("cancels stalled TLS handshake with shared %s and closes the socket", async mode => {
    const sockets = new Set<Socket>();
    const tcp = createTcpServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.resume(); });
    await new Promise<void>(resolve => tcp.listen(0, "127.0.0.1", resolve));
    const address = tcp.address(); if (!address || typeof address === "string") throw new Error();
    const controller = new AbortController();
    const start = performance.now();
    const timer = mode === "signal" ? setTimeout(() => controller.abort(), 70) : undefined;
    try {
      await expect(verifyTlsPreflight(environment(`https://localhost:${address.port}`),
        { signal: controller.signal, remainingMs: () => mode === "budget" ? Math.max(0, 70 - (performance.now() - start)) : 2000 }, secret(), trustedRequest)).rejects.toThrow("TLS_PREFLIGHT_CANCELLED");
      expect(performance.now() - start).toBeLessThan(1000);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(sockets.size).toBe(0);
    } finally { clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
  });
});
