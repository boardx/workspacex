/**
 * D9 —— 客户实例侧上报周期：报告永远过契约、同意关 ⇒ 分节缺席、personal-local 已排除、
 * 地址未设 ⇒ 零网络、发送失败不抛不重试、实例标识是 64 位哈希。
 */
import { describe, expect, it, vi } from "vitest";
import { instanceTelemetry as T } from "@repo/contracts";
import { instanceIdFromSecret, runTelemetryCycle, type TelemetryCycleConfig } from "../../src/application/telemetry/run-telemetry-cycle";
import type { TelemetryConsent, TelemetryFactsSource, TelemetryStateRepository, TelemetryStateRow, TelemetryTransport } from "../../src/application/telemetry/telemetry-ports";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import { HttpTelemetryTransport } from "../../src/infrastructure/telemetry/http-telemetry-transport";
import { readTelemetryConfig } from "../../src/infrastructure/telemetry/telemetry-config";

const SECRET = "a".repeat(64);
const HEALTH = { uptimeRatio: 0.99, latencyP50Ms: 12, latencyP95Ms: 80, queueDepth: 3, diskUsedRatio: 0.4, migrationVersion: "0270" };

function fakeState(consent: TelemetryConsent = { ...T.TELEMETRY_CONSENT_DEFAULTS }) {
  const attempts: NonNullable<TelemetryStateRow["last"]>[] = [];
  const repo: TelemetryStateRepository = {
    ensure: vi.fn(async () => ({ installSecret: SECRET, consent, last: attempts.at(-1) ?? null })),
    updateConsent: vi.fn(async (p) => ({ ...consent, ...p })),
    recordAttempt: vi.fn(async (a) => { attempts.push(a); }),
  };
  return { repo, attempts };
}
const facts = (h: typeof HEALTH | null = HEALTH): TelemetryFactsSource => ({
  health: vi.fn(async () => (h ? { facts: h, personalLocalExcluded: true as const } : null)),
});
const okTransport = (): TelemetryTransport & { bodies: string[] } => {
  const bodies: string[] = [];
  return { bodies, post: vi.fn(async (_e: string, b: string) => { bodies.push(b); return { ok: true }; }) };
};
const logger = (): LoggerPort => ({ info: vi.fn(), error: vi.fn() });
const cfg = (over: Partial<TelemetryCycleConfig> = {}): TelemetryCycleConfig => ({
  endpoint: "https://telemetry.example.test/v1/report", killSwitch: false, timeoutMs: 5000, edition: T.InstanceTelemetryReport.innerType().shape.edition.options[0], productVersion: "1.2.3", ...over,
});
const now = () => new Date("2026-09-24T00:00:00.000Z");

describe("runTelemetryCycle", () => {
  it("出厂默认（只有 health）：发出的报告过契约校验，只带 health 分节，且与本地保存的一致", async () => {
    const { repo, attempts } = fakeState();
    const t = okTransport();
    const r = await runTelemetryCycle({ state: repo, facts: facts(), transport: t, logger: logger(), now }, cfg());
    expect(r).toEqual({ kind: "sent" });
    const sent = JSON.parse(t.bodies[0]!);
    expect(T.InstanceTelemetryReport.safeParse(sent).success).toBe(true);
    expect(sent.health).toEqual(HEALTH);
    expect(sent).not.toHaveProperty("usage");
    expect(sent.excludesPersonalLocalOrgs).toBe(true);
    expect(attempts.at(-1)).toMatchObject({ outcome: "sent", report: sent });
  });

  it("同意关 ⇒ 对应分节缺席；已同意但无真实来源 ⇒ 缺席并如实列入 omittedForLackOfData", async () => {
    const { repo, attempts } = fakeState({ health: false, usage: true, diagnostics: false, benchmark: true });
    const t = okTransport();
    const f = facts();
    await runTelemetryCycle({ state: repo, facts: f, transport: t, logger: logger(), now }, cfg());
    const sent = JSON.parse(t.bodies[0]!);
    expect(f.health).not.toHaveBeenCalled();
    for (const s of ["health", "usage", "diagnostics", "benchmark"]) expect(sent).not.toHaveProperty(s);
    expect(T.InstanceTelemetryReport.safeParse(sent).success).toBe(true);
    expect(attempts.at(-1)!.omittedForLackOfData).toEqual(["usage", "benchmark"]);
  });

  it("health 同意但周期内无探活数据 ⇒ 整节缺席，不造数", async () => {
    const { repo, attempts } = fakeState();
    const t = okTransport();
    await runTelemetryCycle({ state: repo, facts: facts(null), transport: t, logger: logger(), now }, cfg());
    expect(JSON.parse(t.bodies[0]!)).not.toHaveProperty("health");
    expect(attempts.at(-1)!.omittedForLackOfData).toEqual(["health"]);
  });

  it("报告过不了契约（版本号不合法）⇒ 不发，记 invalid，report 为 null", async () => {
    const { repo, attempts } = fakeState();
    const t = okTransport();
    const r = await runTelemetryCycle({ state: repo, facts: facts(), transport: t, logger: logger(), now }, cfg({ productVersion: "dev" }));
    expect(r).toEqual({ kind: "invalid" });
    expect(t.post).not.toHaveBeenCalled();
    expect(attempts.at(-1)).toMatchObject({ outcome: "invalid", report: null });
  });

  it("上报地址未设 ⇒ 零网络、零数据库；总开关 ⇒ 同样", async () => {
    for (const c of [cfg({ endpoint: null }), cfg({ killSwitch: true })]) {
      const { repo } = fakeState();
      const t = okTransport();
      const r = await runTelemetryCycle({ state: repo, facts: facts(), transport: t, logger: logger(), now }, c);
      expect(r.kind).toBe("skipped");
      expect(t.post).not.toHaveBeenCalled();
      expect(repo.ensure).not.toHaveBeenCalled();
    }
  });

  it("发送失败 / 依赖抛错 ⇒ 不抛、只调一次、不重试", async () => {
    const { repo, attempts } = fakeState();
    const post = vi.fn(async () => ({ ok: false }));
    const r = await runTelemetryCycle({ state: repo, facts: facts(), transport: { post }, logger: logger(), now }, cfg());
    expect(r).toEqual({ kind: "failed" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(attempts.at(-1)!.outcome).toBe("failed");

    const boom: TelemetryFactsSource = { health: vi.fn(async () => { throw new Error("db down"); }) };
    await expect(runTelemetryCycle({ state: repo, facts: boom, transport: okTransport(), logger: logger(), now }, cfg())).resolves.toEqual({ kind: "failed" });
  });

  it("HttpTelemetryTransport：fetch 抛错 / 非 2xx ⇒ { ok: false }，不抛", async () => {
    const throwing = new HttpTelemetryTransport((async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    await expect(throwing.post("https://x.test", "{}", 10)).resolves.toEqual({ ok: false });
    const bad = new HttpTelemetryTransport((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    await expect(bad.post("https://x.test", "{}", 10)).resolves.toEqual({ ok: false });
  });

  it("instanceId 是安装密钥的 64 位十六进制哈希，不等于密钥本身", () => {
    const id = instanceIdFromSecret(SECRET);
    expect(T.InstanceId.safeParse(id).success).toBe(true);
    expect(id).not.toBe(SECRET);
  });

  it("readTelemetryConfig：未设地址 ⇒ endpoint null；总开关识别 1/true", () => {
    expect(readTelemetryConfig({}).endpoint).toBeNull();
    expect(readTelemetryConfig({ WSX_TELEMETRY_ENDPOINT: "not a url" }).endpoint).toBeNull();
    expect(readTelemetryConfig({ WSX_TELEMETRY_DISABLED: "true" }).killSwitch).toBe(true);
    expect(readTelemetryConfig({}).productVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
