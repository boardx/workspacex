import { EventEmitter } from "node:events";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { fetchImportSource, GITHUB_IMPORT_TOKEN_ENV, GithubImportRateLimitError } from "../../src/infrastructure/skill/http-import-fetcher";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function replies(responses: { status: number; headers?: Record<string, string> }[]) {
  return vi.spyOn(https, "request").mockImplementation(((_url: unknown, _options: unknown, cb: (r: IncomingMessage) => void) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra attempt");
    const request = Object.assign(new EventEmitter(), { end() {
      queueMicrotask(() => {
        const incoming = Object.assign(new EventEmitter(), { statusCode: next.status, headers: next.headers ?? {} });
        cb(incoming as IncomingMessage); incoming.emit("data", Buffer.from("ok")); incoming.emit("end");
      });
    } });
    return request;
  }) as typeof https.request);
}
const policy = { localOnlyOrg: false };
it.each(["api.github.com", "raw.githubusercontent.com", "api.github.com.evil.example", "api.github.com:444"])(
  "attaches only the explicit token on a direct trusted request: %s", async (host) => {
    vi.stubEnv(GITHUB_IMPORT_TOKEN_ENV, "read_only_test_token");
    vi.stubEnv("GH_TOKEN", "admin_not_for_import");
    const request = replies([{ status: 200 }]);
    await fetchImportSource(`https://${host}/repos/example/repo`, policy);
    const headers = (request.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe(host === "api.github.com" ? "Bearer read_only_test_token" : undefined);
    expect(JSON.stringify(headers)).not.toContain("admin_not_for_import");
  },
);
it.each([
  ["https://api.github.com/repos/a/b", "https://raw.githubusercontent.com/a/b/main/SKILL.md"],
  ["https://api.github.com/repos/a/b", "https://api.github.com/repos/a/c"],
  ["https://example.com/skill", "https://api.github.com/repos/a/b"],
])("never attaches credentials after a redirect: %s -> %s", async (start, location) => {
  vi.stubEnv(GITHUB_IMPORT_TOKEN_ENV, "read_only_test_token");
  const request = replies([{ status: 302, headers: { location } }, { status: 200 }]);
  await fetchImportSource(start, policy);
  expect((request.mock.calls[1]![1] as { headers: Record<string, string> }).headers.authorization).toBeUndefined();
});
it("retries a short quota wait once and returns actual successful bytes", async () => {
  const request = replies([{ status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "0" } }, { status: 200 }]);
  expect((await fetchImportSource("https://api.github.com/repos/a/b", policy)).body.toString()).toBe("ok");
  expect(request).toHaveBeenCalledTimes(2);
});
it("preserves persistent rate limiting after the bounded retry", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const limited = { status: 429, headers: { "retry-after": "0" } };
  const request = replies([limited, limited]);
  await expect(fetchImportSource("https://api.github.com/repos/a/b", policy)).rejects.toBeInstanceOf(GithubImportRateLimitError);
  expect(request).toHaveBeenCalledTimes(2);
});
it("does not wait for long quota resets or retry ordinary forbidden responses", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = replies([{ status: 429, headers: { "retry-after": "3600" } }, { status: 403 }]);
  await expect(fetchImportSource("https://api.github.com/repos/a/b", policy)).rejects.toMatchObject({ retryable: true, retryAfterMs: 3600000 });
  await expect(fetchImportSource("https://api.github.com/repos/a/b", policy)).rejects.toMatchObject({ name: "ImportSourceRefusedError" });
  expect(request).toHaveBeenCalledTimes(2);
});
it("still rejects forbidden redirect destinations before any second request", async () => {
  const request = replies([{ status: 302, headers: { location: "https://127.0.0.1/private" } }]);
  await expect(fetchImportSource("https://api.github.com/repos/a/b", policy)).rejects.toBeDefined();
  expect(request).toHaveBeenCalledTimes(1);
});
