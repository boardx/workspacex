/**
 * #4249 —— 上报器 → 收集 → 车队投影 的跨应用契约测试（收集端这一半，真 workerd）。
 *
 * 不 import apps/api 的上报器（运营面与生产面之间不许有代码依赖）：投递的是
 * `packages/contracts/tests/fixtures/instance-telemetry-wire.json` 里录下的**原样**请求
 * （路径 / 头 / 体）。该 fixture 由 `apps/api/tests/telemetry/telemetry-wire-fixture.test.ts`
 * 断言与真实 `runTelemetryCycle` + `HttpTelemetryTransport` 的输出逐字相等——两边共用一份事实。
 */
import { TELEMETRY_REPORT_INTERVAL_SECONDS, type InstanceTelemetryReportValue } from "@repo/contracts/instance-telemetry";
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wire from "../../../packages/contracts/tests/fixtures/instance-telemetry-wire.json";
import type { FleetProjection } from "../src/fleet";
import { sha256Hex } from "./helpers";

const BASE = "https://telemetry.test";
type WireRequest = (typeof wire)["defaultConsent"];

function deliver(w: WireRequest, over: { body?: string; authorization?: string } = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${w.path}`, {
    method: w.method,
    headers: { ...w.headers, ...(over.authorization ? { authorization: over.authorization } : {}) },
    body: over.body ?? w.body,
  });
}

/** 车队 DO 的投影，`now` 由调用方注入——这是收集端现有的唯一时钟注入点。 */
async function projectionAt(now: number): Promise<FleetProjection> {
  const fleet = env.FLEET.get(env.FLEET.idFromName("fleet"));
  return (await (await fleet.fetch(`https://do/projection?now=${now}`)).json()) as FleetProjection;
}

const reported = JSON.parse(wire.defaultConsent.body) as InstanceTelemetryReportValue;

describe("#4249 上报器录下的请求 → 收集端", () => {
  it("fixture 自洽：instanceId = sha256(Bearer 密钥)", async () => {
    expect(wire.defaultConsent.headers.authorization).toBe(`Bearer ${wire.installSecret}`);
    expect(await sha256Hex(wire.installSecret)).toBe(reported.instanceId);
  });

  it("原样投递被接受（202），车队投影出现该实例，版本与健康同上报；2× 周期无上报判逾期", async () => {
    const before = Date.now();
    expect((await deliver(wire.defaultConsent)).status).toBe(202);

    const p = await projectionAt(Date.now());
    const inst = p.instances.find((i) => i.instanceId === reported.instanceId);
    expect(inst).toMatchObject({ productVersion: reported.productVersion, edition: reported.edition, health: "healthy", overdue: false });
    expect(p.byVersion[reported.productVersion]).toBe(1);
    expect(p.reportIntervalSeconds).toBe(TELEMETRY_REPORT_INTERVAL_SECONDS);

    const receivedAt = inst!.receivedAt;
    expect(receivedAt).toBeGreaterThanOrEqual(before);
    const twoIntervals = 2 * TELEMETRY_REPORT_INTERVAL_SECONDS * 1000;
    expect((await projectionAt(receivedAt + twoIntervals)).overdue).toEqual([]);
    const late = await projectionAt(receivedAt + twoIntervals + 1);
    expect(late.overdue).toEqual([{ instanceId: reported.instanceId, receivedAt }]);
    expect(late.instances.find((i) => i.instanceId === reported.instanceId)!.overdue).toBe(true);
  });

  it("反例：体里多一个像内容的字段 ⇒ 422，且不回显", async () => {
    const body = JSON.stringify({ ...reported, note: "客户在会上说要换供应商" });
    const r = await deliver(wire.defaultConsent, { body });
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain("供应商");
  });

  it("反例：密钥的哈希不等于 instanceId ⇒ 401", async () => {
    const r = await deliver(wire.defaultConsent, { authorization: `Bearer ${"6".repeat(64)}` });
    expect(r.status).toBe(401);
  });

  it("同意全关的上报：分节缺席，被接受，投影里健康为 unreported", async () => {
    const off = JSON.parse(wire.consentOff.body) as Record<string, unknown>;
    for (const s of ["health", "usage", "diagnostics", "benchmark"]) expect(off).not.toHaveProperty(s);
    expect((await deliver(wire.consentOff)).status).toBe(202);
    const inst = (await projectionAt(Date.now())).instances.find((i) => i.instanceId === reported.instanceId);
    expect(inst).toMatchObject({ productVersion: reported.productVersion, health: "unreported", overdue: false });
  });
});
