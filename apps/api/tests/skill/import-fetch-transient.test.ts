import { EventEmitter } from "node:events";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchImportSource } from "../../src/infrastructure/skill/http-import-fetcher";

const policy = { localOnlyOrg: false };
const api = "https://api.github.com/repos/example/repo/contents/skill?ref=main";
type Reply = { status?: number; headers?: Record<string, string>; error?: string; delay?: number; stall?: boolean };
function server(replies: Reply[]) {
  const seen: { url: string; headers: Record<string, string>; destroyed: boolean }[] = [];
  vi.spyOn(https, "request").mockImplementation(((url: URL, options: { headers: Record<string, string> }, callback: (r: IncomingMessage) => void) => {
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra network attempt");
    const entry = { url: url.toString(), headers: options.headers, destroyed: false }; seen.push(entry);
    const req = Object.assign(new EventEmitter(), {
      destroy() { entry.destroyed = true; },
      end() {
        const respond = () => {
          if (entry.destroyed || reply.stall) return;
          if (reply.error) { req.emit("error", Object.assign(new Error("connection failed"), { code: reply.error })); return; }
          const response = Object.assign(new EventEmitter(), { statusCode: reply.status, headers: reply.headers ?? {} });
          callback(response as IncomingMessage); response.emit("data", Buffer.from("actual skill bytes")); response.emit("end");
        };
        if (reply.delay) setTimeout(respond, reply.delay); else queueMicrotask(respond);
      },
    });
    return req;
  }) as typeof https.request);
  return seen;
}
async function finish<T>(operation: Promise<T>): Promise<T> {
  const settled = operation.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const result = await settled;
  if ("error" in result) throw result.error;
  return result.value;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2030-01-01T00:00:00Z")); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([502, 503, 504])("recovers actual bytes from a transient GitHub %s without changing target", async status => {
  const seen = server([{ status }, { status: 200 }]);
  expect((await finish(fetchImportSource(api, policy))).body.toString()).toBe("actual skill bytes");
  expect(seen.map(x => x.url)).toEqual([api, api]);
  expect(seen.every(x => x.headers.accept === "application/vnd.github+json")).toBe(true);
});
it.each(["api.github.com", "raw.githubusercontent.com"])("recovers a reset for trusted GitHub host %s", async host => {
  const seen = server([{ error: "ECONNRESET" }, { status: 200 }]);
  expect((await finish(fetchImportSource(`https://${host}/skill`, policy))).body.toString()).toBe("actual skill bytes");
  expect(seen).toHaveLength(2);
});
it("refuses persistent transient failure after three total GET attempts", async () => {
  const seen = server([{ status: 502 }, { status: 503 }, { status: 504 }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(seen).toHaveLength(3);
});
it.each([401, 403, 404, 500])("does not retry ordinary HTTP %s", async status => {
  const seen = server([{ status }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(seen).toHaveLength(1);
});
it.each(["https://example.com/skill", "https://api.github.com.evil.example/skill", "https://api.github.com:444/skill"])("does not retry unsupported target %s", async url => {
  const seen = server([{ status: 502 }]);
  await expect(finish(fetchImportSource(url, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(seen).toHaveLength(1);
});
it("does not retry an unknown transport error", async () => {
  const seen = server([{ error: "CERT_HAS_EXPIRED" }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "CERT_HAS_EXPIRED" });
  expect(seen).toHaveLength(1);
});
it.each(["1", "Tue, 01 Jan 2030 00:00:01 GMT"])("waits for valid Retry-After %s", async retry => {
  const seen = server([{ status: 503, headers: { "retry-after": retry } }, { status: 200 }]);
  const operation = fetchImportSource(api, policy);
  const settled = operation.then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(500); expect(seen).toHaveLength(1);
  await vi.runAllTimersAsync(); const result = await settled;
  expect("value" in result).toBe(true); expect(seen).toHaveLength(2);
});
it("refuses Retry-After beyond the short-wait budget without immediate replay", async () => {
  const seen = server([{ status: 503, headers: { "retry-after": "60" } }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(seen).toHaveLength(1);
});
it("does not send an already cancelled request", async () => {
  const seen = server([]); const controller = new AbortController(); controller.abort();
  await expect(finish(fetchImportSource(api, policy, undefined, { signal: controller.signal }))).rejects.toMatchObject({ name: "AbortError" });
  expect(seen).toHaveLength(0);
});
it("cancels an active socket instead of waiting for its timeout", async () => {
  const seen = server([{ stall: true }]); const controller = new AbortController();
  const pending = fetchImportSource(api, policy, undefined, { signal: controller.signal });
  const settled = pending.then(() => null, error => error);
  controller.abort(); await vi.runAllTimersAsync(); expect(await settled).toMatchObject({ name: "AbortError" });
  expect(seen).toHaveLength(1); expect(seen[0]!.destroyed).toBe(true);
});
it("cancels backoff and never issues another GET", async () => {
  const seen = server([{ status: 502 }]); const controller = new AbortController();
  const pending = fetchImportSource(api, policy, undefined, { signal: controller.signal });
  const settled = pending.then(() => null, error => error);
  await vi.advanceTimersByTimeAsync(50); controller.abort(); await vi.runAllTimersAsync(); expect(await settled).toMatchObject({ name: "AbortError" });
  expect(seen).toHaveLength(1);
});
it("enforces a shared ten-second deadline across attempts and an active socket", async () => {
  const seen = server([{ status: 502, delay: 9_500 }, { stall: true }]);
  const started = Date.now();
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_TIMEOUT" });
  expect(Date.now() - started).toBe(10_000); expect(seen).toHaveLength(2); expect(seen[1]!.destroyed).toBe(true);
});
it("preserves redirect SSRF refusal before retry", async () => {
  const seen = server([{ status: 302, headers: { location: "https://127.0.0.1/private" } }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toBeDefined(); expect(seen).toHaveLength(1);
});
it("never restores the credential when a redirected GitHub target is retried", async () => {
  vi.stubEnv("WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN", "public_read_only");
  const seen = server([{ status: 302, headers: { location: "https://api.github.com/repos/other/skill" } }, { status: 502 }, { status: 200 }]);
  expect((await finish(fetchImportSource(api, policy))).body.toString()).toBe("actual skill bytes");
  expect(seen[0]!.headers.authorization).toBe("Bearer public_read_only");
  expect(seen.slice(1).every(x => x.headers.authorization === undefined)).toBe(true);
});
it("shares the three-attempt cap with existing quota recovery", async () => {
  const seen = server([{ status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "0" } }, { status: 502 }, { status: 503 }]);
  await expect(finish(fetchImportSource(api, policy))).rejects.toMatchObject({ code: "IMPORT_FETCH_FAILED" });
  expect(seen).toHaveLength(3);
});
