import { EventEmitter } from "node:events";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { fetchImportSource } from "../../src/infrastructure/skill/http-import-fetcher";

afterEach(() => vi.restoreAllMocks());

function response(status: number, headers: Record<string, string | string[]> = {}) {
  vi.spyOn(https, "request").mockImplementation(((_url: unknown, _options: unknown, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => queueMicrotask(() => {
      const incoming = Object.assign(new EventEmitter(), { statusCode: status, headers });
      // Only the response event surface used by the fetcher is simulated.
      callback(incoming as IncomingMessage);
      incoming.emit("data", Buffer.from('secret response body'));
      incoming.emit("end");
    });
    return request;
  }) as typeof https.request);
}

it("logs only bounded allowlisted GitHub failure diagnostics, preserving error", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  response(403, {
    "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000",
    "retry-after": "30", "x-github-request-id": "ABCD:1234",
    authorization: "secret-token", "set-cookie": "secret-cookie", "x-secret": "private",
  });
  await expect(fetchImportSource("https://api.github.com/repos/private-name?secret=query", { localOnlyOrg: false }))
    .rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("[skill-import] upstream-http-failure", {
    host: "api.github.com", status: 403, headers: {
      "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000",
      "retry-after": "30", "x-github-request-id": "ABCD:1234",
    },
  });
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private-name|query/);
});

it("omits invalid, oversized and array diagnostic values", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  response(429, { "retry-after": "x\nsecret", "x-ratelimit-limit": "a".repeat(129),
    "x-ratelimit-reset": ["secret"], "x-github-request-id": "https://secret.invalid" });
  await expect(fetchImportSource("https://api.github.com/example", { localOnlyOrg: false })).rejects.toBeDefined();
  expect(warn.mock.calls[0]?.[1]).toEqual({ host: "api.github.com", status: 429, headers: {} });
});

it.each([[200, "api.github.com"], [403, "raw.githubusercontent.com"], [403, "api.github.com.example.com"]])(
  "no diagnostic noise for status %s host %s", async (status, host) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    response(status);
    await fetchImportSource(`https://${host}/example`, { localOnlyOrg: false }).catch(() => undefined);
    expect(warn).not.toHaveBeenCalled();
  },
);
