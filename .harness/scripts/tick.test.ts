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
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
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
      { url: "https://coord.example/api/coord/time", method: "GET", body: undefined },
      { url: "https://coord.example/api/coord/repos/boardx/workspacex/claims", method: "GET", body: undefined },
      {
        url: "https://coord.example/api/coord/repos/boardx/workspacex/claims/lse_test/heartbeat",
        method: "POST",
        body: JSON.stringify({ protocol: "coord/0.1", agent_id: "coord-main-test" }),
      },
      {
        url: "https://coord.example/api/coord/repos/boardx/workspacex/tasks?assignee=coord-main-test&status=pending",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("uses --session for scoped/ops identity even when COORD_AGENT_ID is stale", async () => {
    configured();
    process.env.COORD_AGENT_ID = "stale-agent";
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/claims") && (init?.method ?? "GET") === "GET") {
        return json({ leases: [{
          protocol: "coord/0.1", lease_id: "lse_module", resource_id: "module:board",
          resource_type: "module", agent_id: "coord-board", status: "in_progress",
          claimed_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(),
          ttl_seconds: 900, expires_at: new Date(Date.now() + 900_000).toISOString(), handoff_note: null,
        }] });
      }
      if (url.endsWith("/claims/lse_module/heartbeat")) {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ lease_id: "lse_module" });
      }
      if (url.includes("/tasks?assignee=coord-board&status=pending")) return json({ tasks: [] });
      return json({ error: "unexpected" }, 404);
    }));

    await tick({ _: [], flags: { json: true }, opts: { session: "coord-board" } });

    expect(process.exitCode).toBeUndefined();
    expect(bodies).toEqual([{ protocol: "coord/0.1", agent_id: "coord-board" }]);
  });

  it("renews every lease owned by the current agent and reports heartbeat failures", async () => {
    configured();
    const heartbeatIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/claims") && (init?.method ?? "GET") === "GET") {
        const base = {
          protocol: "coord/0.1", resource_type: "custom", agent_id: "coord-main-test",
          status: "in_progress", claimed_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(), ttl_seconds: 900,
          expires_at: new Date(Date.now() + 900_000).toISOString(), handoff_note: null,
        };
        return json({ leases: [
          { ...base, lease_id: "lse_ok", resource_id: "role:coord-main" },
          { ...base, lease_id: "lse_gone", resource_id: "issue:379" },
          { ...base, lease_id: "lse_forbidden", resource_id: "issue:380" },
          { ...base, lease_id: "lse_other", resource_id: "module:room", agent_id: "coord-room" },
        ] });
      }
      if (url.includes("/heartbeat")) {
        const id = url.split("/").at(-2)!;
        heartbeatIds.push(id);
        if (id === "lse_ok") return json({ lease_id: id });
        return id === "lse_gone" ? json({ status: "expired" }, 410) : json({ error: "forbidden" }, 403);
      }
      if (url.includes("/tasks?")) return json({ tasks: [] });
      return json({ error: "unexpected" }, 404);
    }));

    await tick(args);

    expect(heartbeatIds).toEqual(["lse_ok", "lse_gone", "lse_forbidden"]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("租约已终态"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
  });

  it("applies an 8 second AbortSignal to claims and heartbeat requests", async () => {
    configured();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/claims")) {
        if (init?.signal) signals.push(init.signal);
        const now = new Date().toISOString();
        return json({ leases: [{
          protocol: "coord/0.1", lease_id: "lse_timeout", resource_id: "role:coord-main",
          resource_type: "coordinator-role", agent_id: "coord-main-test", status: "in_progress",
          claimed_at: now, last_heartbeat_at: now, ttl_seconds: 900,
          expires_at: new Date(Date.now() + 900_000).toISOString(), handoff_note: null,
        }] });
      }
      if (url.endsWith("/claims/lse_timeout/heartbeat")) {
        if (init?.signal) signals.push(init.signal);
        return json({ lease_id: "lse_timeout" });
      }
      if (url.includes("/tasks?")) return json({ tasks: [] });
      return json({ error: "unexpected" }, 404);
    }));

    await tick(args);

    expect(process.exitCode).toBeUndefined();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
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
