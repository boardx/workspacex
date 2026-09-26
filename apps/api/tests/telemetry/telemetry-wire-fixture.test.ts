/**
 * #4249 —— 上报器 → ops-telemetry 收集端的跨应用契约测试（上报器这一半）。
 *
 * 两个应用之间不许有生产代码依赖（lint-production-not-on-ops / ops-plane 归属），所以不让
 * ops 测试 import 本应用的上报器，而是共享**一份**录下来的线上请求：
 *   packages/contracts/tests/fixtures/instance-telemetry-wire.json
 * 本测试断言：真实的 `runTelemetryCycle` + `HttpTelemetryTransport` 发出的 HTTP 请求（路径 / 头 / 体）
 * **逐字等于**该 fixture；`apps/ops-telemetry/test/reporter-contract.test.ts` 断言收集端接受它。
 * 任何一边变了形，另一边的测试就红。重录：`UPDATE_TELEMETRY_WIRE_FIXTURE=1 pnpm vitest run <本文件>`。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { instanceTelemetry as T } from "@repo/contracts";
import { instanceIdFromSecret, runTelemetryCycle } from "../../src/application/telemetry/run-telemetry-cycle";
import type { TelemetryConsent, TelemetryFactsSource, TelemetryStateRepository } from "../../src/application/telemetry/telemetry-ports";
import { HttpTelemetryTransport } from "../../src/infrastructure/telemetry/http-telemetry-transport";

const FIXTURE = fileURLToPath(new URL("../../../../packages/contracts/tests/fixtures/instance-telemetry-wire.json", import.meta.url));
/** 仅测试用的安装密钥（64 位十六进制）；instanceId = sha256(它)。 */
const SECRET = "5".repeat(64);
const ENDPOINT = "https://telemetry.example.test/v1/report";
const HEALTH = { uptimeRatio: 0.999, latencyP50Ms: 12, latencyP95Ms: 80, queueDepth: 2, diskUsedRatio: 0.4, migrationVersion: "0270" };

interface WireRequest { method: string; path: string; headers: Record<string, string>; body: string }

async function capture(consent: TelemetryConsent): Promise<WireRequest> {
  const state: TelemetryStateRepository = {
    ensure: async () => ({ installSecret: SECRET, consent, last: null }),
    updateConsent: async (p) => ({ ...consent, ...p }),
    recordAttempt: async () => {},
  };
  const facts: TelemetryFactsSource = {
    health: async () => ({ facts: HEALTH, personalLocalExcluded: true as const }),
    firstValueFacts: async () => ({ facts: [], personalLocalExcluded: true as const }),
    usageBase: async () => null,
    runsPerSeatPerWeek: async () => null,
  };
  let req: WireRequest | undefined;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    req = {
      method: String(init.method),
      path: new URL(url).pathname,
      headers: Object.fromEntries([...h.entries()].sort(([a], [b]) => a.localeCompare(b))),
      body: String(init.body),
    };
    return new Response(null, { status: 202 });
  });
  const r = await runTelemetryCycle(
    {
      state,
      facts,
      transport: new HttpTelemetryTransport(fetchImpl as unknown as typeof fetch),
      logger: { info: vi.fn(), error: vi.fn() },
      now: () => new Date("2026-09-24T00:00:00.000Z"),
    },
    { endpoint: ENDPOINT, killSwitch: false, timeoutMs: 5000, edition: "cloud", productVersion: "3.4.5" },
  );
  expect(r).toEqual({ kind: "sent" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  return req!;
}

describe("#4249 上报器线上请求 = 共享 fixture", () => {
  it("出厂默认（仅 health）与同意全关两份请求，逐字等于 fixture", async () => {
    const actual = {
      installSecret: SECRET,
      defaultConsent: await capture({ ...T.TELEMETRY_CONSENT_DEFAULTS }),
      consentOff: await capture({ health: false, usage: false, diagnostics: false, benchmark: false }),
    };
    if (process.env.UPDATE_TELEMETRY_WIRE_FIXTURE === "1") writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(actual);

    // 自检：fixture 本身满足契约与认证规则，否则两边都"绿"也没意义。
    expect(actual.defaultConsent.headers.authorization).toBe(`Bearer ${SECRET}`);
    for (const c of [actual.defaultConsent, actual.consentOff]) {
      const body = T.InstanceTelemetryReport.parse(JSON.parse(c.body));
      expect(body.instanceId).toBe(instanceIdFromSecret(SECRET));
    }
    expect(JSON.parse(actual.defaultConsent.body).health).toEqual(HEALTH);
    expect(JSON.parse(actual.consentOff.body)).not.toHaveProperty("health");
  });
});
