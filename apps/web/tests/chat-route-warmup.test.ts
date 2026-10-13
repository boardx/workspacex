import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { warmChatRoute, warmupFailureDiagnostic } from "../e2e/support/chat-route-warmup";

it("reports only allowlisted nested connection codes without message URL or credentials", () => {
  const cause = Object.assign(new Error("secret password URL https://private.invalid SQL SELECT"), { code: "ECONNREFUSED" });
  const value = warmupFailureDiagnostic(new TypeError("fetch failed", { cause }));
  expect(value).toEqual({ kind: "chat-warmup-failure-v1", errorType: "TypeError", errorCode: "ECONNREFUSED" });
  expect(JSON.stringify(value)).not.toContain("secret");
  expect(warmupFailureDiagnostic(Object.assign(new Error("secret"), { code: "SECRET_VALUE" })).errorCode).toBeNull();
  expect(warmupFailureDiagnostic("secret").errorType).toBe("Unknown");
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing bound address");
  return `http://127.0.0.1:${address.port}/hanging-route`;
}

it("aborts a real hanging request without closing the server to unblock it", async () => {
  let accepted = false;
  const url = await serve(() => { accepted = true; });
  const started = performance.now();
  await expect(warmChatRoute(url, 200)).rejects.toThrow("within 200ms");
  expect(accepted).toBe(true);
  expect(performance.now() - started).toBeLessThan(2_000);
});

it("keeps retrying 5xx within one budget and accepts a manual redirect", async () => {
  let attempts = 0;
  const url = await serve((_request, response) => {
    response.writeHead(++attempts === 1 ? 503 : 307, { Location: "/must-not-follow" });
    response.end();
  });
  await warmChatRoute(url, 1_000, 10);
  expect(attempts).toBe(2);
});

it("reports persistent server failures with route and final HTTP status", async () => {
  const url = await serve((_request, response) => { response.writeHead(503).end(); });
  await expect(warmChatRoute(url, 150, 10)).rejects.toThrow(`${url} did not become ready within 150ms: HTTP 503`);
});
