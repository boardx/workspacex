import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "./tick";
import type { Args } from "./lib/args";

const ENV_KEYS = ["COORD_GATEWAY_URL", "COORD_API_TOKEN", "COORD_REPO", "COORD_AGENT_ID"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const args: Args = { _: [], flags: { json: true }, opts: {} };

function configured(): void {
  process.env.COORD_GATEWAY_URL = "https://coord.example/";
  process.env.COORD_API_TOKEN = "test-token";
  process.env.COORD_REPO = "boardx/workspacex";
  process.env.COORD_AGENT_ID = "coord-main-test";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function timePayload(): Record<string, unknown> {
  const now = new Date();
  return {
    now: now.toISOString(),
    epoch_ms: now.getTime(),
    cycle: {
      id: "cycle-test",
      started_at: now.toISOString(),
      ends_at: new Date(now.getTime() + 60_000).toISOString(),
      remaining_seconds: 60,
      elapsed_seconds: 0,
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  process.exitCode = undefined;
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("tick coord-gateway cutover", () => {
  it("uses gateway time, renews role:coord-main, and reads the repo-scoped inbox", async () => {
    configured();
    const lease = {
      protocol: "coord/0.1",
      lease_id: "lse_test",
      resource_id: "role:coord-main",
      resource_type: "coordinator-role",
      agent_id: "coord-main-test",
      status: "in_progress",
      claimed_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      ttl_seconds: 900,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      handoff_note: null,
    };
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      calls.push({ url, method });
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/api/coord/repos/boardx/workspacex/claims") && method === "GET")
        return json({ leases: [lease] });
      if (url.endsWith("/claims/lse_test/heartbeat") && method === "POST") return json(lease);
      if (url.includes("/tasks?assignee=coord-main-test&status=pending"))
        return json({ tasks: [{ id: 7, issue: 379, priority: "high", note: "repair tick" }] });
      return json({ error: "unexpected" }, 404);
    }));

    await tick(args);

    expect(process.exitCode).toBeUndefined();
    expect(calls).toEqual([
      { url: "https://coord.example/api/coord/time", method: "GET" },
      { url: "https://coord.example/api/coord/repos/boardx/workspacex/claims", method: "GET" },
      { url: "https://coord.example/api/coord/repos/boardx/workspacex/claims/lse_test/heartbeat", method: "POST" },
      {
        url: "https://coord.example/api/coord/repos/boardx/workspacex/tasks?assignee=coord-main-test&status=pending",
        method: "GET",
      },
    ]);
  });

  it("fails visibly when gateway configuration is missing", async () => {
    await tick(args);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("COORD_GATEWAY_URL 未配置"));
  });

  it("fails closed when the authority clock is unreachable", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await tick(args);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/coord/time"));
  });

  it("does not turn an unavailable inbox into an empty inbox", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/claims")) return json({ leases: [] });
      return json({ error: "unavailable" }, 503);
    }));
    await tick(args);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("不能把不可达伪装成空收件箱"));
  });
});
