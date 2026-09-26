/**
 * cycle-report 的 coord-gateway 割接门（issue #381）。
 *
 * 修复前这套测试是红的：`cycle-report.ts` 只读已退役的 `COORD_SERVICE_URL` +
 * `GET /status`，没配 / 问不到都塌缩成一行「跳过租约健康检查」并以 0 退出——
 * 读报告的人拿到一张看起来完整的健康表，却完全看不出权威压根没被问过。
 *
 * 因此这里断言的不是「换了个 URL」，而是三态纪律本身：
 *   free/held（问过了）≠ error（没问到），且 error 必须非零退出 + 可见。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/sh", () => ({ sh: vi.fn() }));

import { cycleReport } from "./cycle-report";
import { sh } from "./lib/sh";
import type { Args } from "./lib/args";

const ENV_KEYS = ["COORD_GATEWAY_URL", "COORD_API_TOKEN", "COORD_REPO", "COORD_AGENT_ID", "COORD_SERVICE_URL", "COORD_SERVICE_TOKEN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const args: Args = { _: [], flags: {}, opts: {} };

/** 只有真的问到了权威、答案确实是"空"，才允许出现这一行。任何 error 臂印出它
 *  就是本 issue 那个缺陷复发：把「没问到」渲染成一张健康的空表。 */
const HEALTHY_CLAIMS_LINE = "已查询权威，当前无活跃租约";

function configured(): void {
  process.env.COORD_GATEWAY_URL = "https://coord.example/";
  process.env.COORD_API_TOKEN = "test-token";
  process.env.COORD_REPO = "boardx/workspacex";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CYCLE_START = "2026-08-03T09:00:00.000Z";
const NOW = "2026-08-03T10:00:00.000Z";

function timePayload(): Record<string, unknown> {
  return {
    now: NOW,
    epoch_ms: Date.parse(NOW),
    cycle: {
      id: "2026-08-03T09Z",
      started_at: CYCLE_START,
      ends_at: "2026-08-03T12:00:00.000Z",
      remaining_seconds: 7200,
      elapsed_seconds: 3600,
    },
  };
}

function lease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: "coord/0.1",
    lease_id: "lse_a",
    resource_id: "role:coord-main",
    resource_type: "coordinator-role",
    agent_id: "coord-main",
    status: "in_progress",
    claimed_at: CYCLE_START,
    last_heartbeat_at: "2026-08-03T09:55:00.000Z",
    ttl_seconds: 21600,
    expires_at: "2026-08-03T15:00:00.000Z",
    ...over,
  };
}

/** gh 全部成功但无数据——把镜头对准 gateway 那一侧。 */
function ghAllEmpty(): void {
  vi.mocked(sh).mockImplementation((cmd: string) => ({ code: 0, stdout: "[]", stderr: "" }));
}

function printed(): string {
  const calls = [
    ...vi.mocked(console.log).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ];
  return calls.map((c) => c.join(" ")).join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  process.exitCode = undefined;
  for (const key of ENV_KEYS) delete process.env[key];
  vi.mocked(sh).mockReset();
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

describe("cycle-report coord-gateway 割接（#381）", () => {
  it("成功路径：只用 COORD_GATEWAY_URL/COORD_API_TOKEN/COORD_REPO + gh，读权威时钟与权威租约", async () => {
    configured();
    ghAllEmpty();
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers ?? {});
      calls.push({ url, auth: headers.get("authorization") });
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      if (url.endsWith("/api/coord/repos/boardx/workspacex/claims"))
        return json({ leases: [lease(), lease({ lease_id: "lse_b", resource_id: "module:chat", agent_id: "coord-chat", last_heartbeat_at: "2026-08-03T08:00:00.000Z" })] });
      return json({ error: "unexpected" }, 404);
    }));

    await cycleReport(args);

    expect(process.exitCode).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([
      "https://coord.example/api/coord/time",
      "https://coord.example/api/coord/repos/boardx/workspacex/claims",
    ]);
    expect(calls[1]?.auth).toBe("Bearer test-token");
    const out = printed();
    // 周期 id 来自权威时钟，不是本机 Date.now()（ADR-014）
    expect(out).toContain("2026-08-03T09Z");
    expect(out).toContain("role:coord-main ← coord-main");
    // 心跳 120 分钟前的租约要被标记为可疑
    expect(out).toMatch(/⚠ module:chat ← coord-chat/);
  });

  it("不再读已退役的 COORD_SERVICE_URL：只配旧变量 = 无权威，非零退出", async () => {
    process.env.COORD_SERVICE_URL = "https://retired.example";
    process.env.COORD_SERVICE_TOKEN = "retired-token";
    ghAllEmpty();
    const fetchSpy = vi.fn(async () => json({ active_claims: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(printed()).toContain("COORD_GATEWAY_URL");
    expect(printed()).not.toContain(HEALTHY_CLAIMS_LINE);
  });

  it("鉴权失败（401）：非零退出，且绝不渲染成「无活跃租约」", async () => {
    configured();
    ghAllEmpty();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      return json({ error: "unauthorized" }, 401);
    }));

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    const out = printed();
    expect(out).toContain("HTTP 401");
    expect(out).not.toContain(HEALTHY_CLAIMS_LINE);
    expect(out).not.toContain("flow time");
  });

  it("鉴权失败（403）同样非零退出", async () => {
    configured();
    ghAllEmpty();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      return json({ error: "forbidden" }, 403);
    }));

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    expect(printed()).toContain("HTTP 403");
    expect(printed()).not.toContain(HEALTHY_CLAIMS_LINE);
  });

  it("网关不可达：非零退出，不按本地时钟硬编周期", async () => {
    configured();
    ghAllEmpty();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    const out = printed();
    expect(out).toContain("/api/coord/time");
    expect(out).not.toContain(HEALTHY_CLAIMS_LINE);
    expect(out).not.toContain("当前周期");
  });

  it("响应形状异常（claims 缺 leases 数组）：非零退出，不塌缩成空租约", async () => {
    configured();
    ghAllEmpty();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      return json({ ok: true });
    }));

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    expect(printed()).toContain("缺少 leases 数组");
    expect(printed()).not.toContain(HEALTHY_CLAIMS_LINE);
  });

  it("gh 叙述源失败也必须可见且非零——不拿空列表冒充「没有超期 PR」", async () => {
    configured();
    vi.mocked(sh).mockImplementation((cmd: string) =>
      cmd.startsWith("gh pr list --state open")
        ? { code: 1, stdout: "gh: could not determine authentication", stderr: "" }
        : { code: 0, stdout: "[]", stderr: "" }
    );
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/coord/time")) return json(timePayload());
      return json({ leases: [] });
    }));

    await cycleReport(args);

    expect(process.exitCode).toBe(1);
    const out = printed();
    expect(out).toContain("读不到 open PR 列表");
    expect(out).not.toMatch(/open PR：0 个/);
    // 权威确实被问过了，这一句才是诚实的
    expect(out).toContain(HEALTHY_CLAIMS_LINE);
  });
});
