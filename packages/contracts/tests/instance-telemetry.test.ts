/**
 * 实例运行信号上报契约（PROPOSED，待签核）的行为测试。
 * 每条对应 super-instance-design.md §3 的一条约束，测的是「违反它的上报会被拒」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InstanceTelemetryReport,
  TELEMETRY_CONSENT_COPY,
  TELEMETRY_CONSENT_DEFAULTS,
  TelemetryConsentItem,
} from "../src/instance-telemetry";

const ALL_ON = { health: true, usage: true, diagnostics: true, benchmark: true };
const valid = () => ({
  schemaVersion: 1 as const,
  instanceId: "a".repeat(64),
  edition: "cloud" as const,
  productVersion: "1.4.0",
  periodEnd: "2026-09-24T00:00:00Z",
  excludesPersonalLocalOrgs: true as const,
  consent: { ...ALL_ON },
  health: { uptimeRatio: 0.999, latencyP50Ms: 120, latencyP95Ms: 900, queueDepth: 3, diskUsedRatio: 0.41, migrationVersion: "0009" },
  usage: { runCount: 812, tokenCount: 4_200_000, seatCount: 25, organizationCount: 3, skillPackRuns: [{ capabilityId: "WX-S021", runCount: 40 }] },
  diagnostics: { errorFingerprints: [{ fingerprint: "b".repeat(64), errorCode: "RUN_TIMEOUT", count: 4 }] },
  benchmark: { runsPerSeatPerWeek: 6.5, firstValueMedianMinutes: 11 },
});

describe("InstanceTelemetryReport（PROPOSED）", () => {
  it("完整合规的上报通过", () => {
    expect(InstanceTelemetryReport.safeParse(valid()).success).toBe(true);
  });

  it("传信号不传内容：任何一层多出一个字段都拒（.strict）", () => {
    const withText = valid() as Record<string, unknown>;
    (withText.diagnostics as { errorFingerprints: Record<string, unknown>[] }).errorFingerprints[0]!.message = "用户 张三 上传的合同……";
    expect(InstanceTelemetryReport.safeParse(withText).success).toBe(false);

    const topLevel = { ...valid(), organizationName: "某某资本" };
    expect(InstanceTelemetryReport.safeParse(topLevel).success).toBe(false);
  });

  it("同意不坍缩成布尔：未同意的那一项，对应分节必须缺席", () => {
    for (const item of TelemetryConsentItem.options) {
      const r = { ...valid(), consent: { ...ALL_ON, [item]: false } };
      expect(InstanceTelemetryReport.safeParse(r).success, item).toBe(false);
      const { [item]: _dropped, ...withoutSection } = r as Record<string, unknown>;
      expect(InstanceTelemetryReport.safeParse(withoutSection).success, `${item} 缺席后应通过`).toBe(true);
    }
  });

  it("同意了但本期没有数据可以不带分节", () => {
    const { benchmark: _b, ...r } = valid();
    expect(InstanceTelemetryReport.safeParse(r).success).toBe(true);
  });

  it("personal-local 排除必须显式声明，false 或缺失都拒", () => {
    expect(InstanceTelemetryReport.safeParse({ ...valid(), excludesPersonalLocalOrgs: false }).success).toBe(false);
    const { excludesPersonalLocalOrgs: _x, ...missing } = valid();
    expect(InstanceTelemetryReport.safeParse(missing).success).toBe(false);
  });

  it("实例标识必须是不可逆哈希，不接受可读名字", () => {
    expect(InstanceTelemetryReport.safeParse({ ...valid(), instanceId: "acme-capital-prod" }).success).toBe(false);
  });

  it("错误码与能力编号只收机器标识，塞不进一句话", () => {
    const r1 = valid();
    r1.diagnostics.errorFingerprints[0]!.errorCode = "合同第三条违约 金额 500 万";
    expect(InstanceTelemetryReport.safeParse(r1).success).toBe(false);
    const r2 = valid();
    r2.usage.skillPackRuns[0]!.capabilityId = "给张总写的尽调报告";
    expect(InstanceTelemetryReport.safeParse(r2).success).toBe(false);
  });

  it("每一项同意都有「关了会失去什么」的文案，且只有这四项", () => {
    expect(Object.keys(TELEMETRY_CONSENT_COPY).sort()).toEqual([...TelemetryConsentItem.options].sort());
    for (const copy of Object.values(TELEMETRY_CONSENT_COPY)) expect(copy.ifOff.length).toBeGreaterThan(4);
  });

  it("出厂默认值：只有健康信号开（D22），且四项都有默认值", () => {
    expect(Object.keys(TELEMETRY_CONSENT_DEFAULTS).sort()).toEqual([...TelemetryConsentItem.options].sort());
    expect(TELEMETRY_CONSENT_DEFAULTS).toEqual({ health: true, usage: false, diagnostics: false, benchmark: false });
  });

  it("按出厂默认值上报：只带健康分节就合规", () => {
    const { usage: _u, diagnostics: _d, benchmark: _b, ...r } = valid();
    expect(InstanceTelemetryReport.safeParse({ ...r, consent: { ...TELEMETRY_CONSENT_DEFAULTS } }).success).toBe(true);
    expect(InstanceTelemetryReport.safeParse({ ...valid(), consent: { ...TELEMETRY_CONSENT_DEFAULTS } }).success).toBe(false);
  });

  it("仍是 PROPOSED：没有从 index.ts 导出（签核前不许被消费）", () => {
    const index = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8");
    expect(index).not.toMatch(/instance-telemetry/);
  });
});
