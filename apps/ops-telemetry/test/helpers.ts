import type { InstanceTelemetryReportValue } from "@repo/contracts/instance-telemetry";

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Opts {
  seed: string;
  productVersion?: string;
  edition?: "cloud" | "local";
  health?: Partial<NonNullable<InstanceTelemetryReportValue["health"]>>;
  noHealth?: boolean;
}

/** 造一份合法上报；安装密钥由 seed 派生，instanceId = sha256(密钥)。 */
export async function makeReport(o: Opts): Promise<{ secret: string; report: InstanceTelemetryReportValue }> {
  const secret = await sha256Hex(`install-secret-${o.seed}`);
  const instanceId = await sha256Hex(secret);
  const report: InstanceTelemetryReportValue = {
    schemaVersion: 1,
    instanceId,
    edition: o.edition ?? "cloud",
    productVersion: o.productVersion ?? "1.0.0",
    periodEnd: "2026-09-24T00:00:00Z",
    excludesPersonalLocalOrgs: true,
    consent: { health: !o.noHealth, usage: true, diagnostics: false, benchmark: false },
    ...(o.noHealth
      ? {}
      : {
          health: {
            uptimeRatio: 0.999,
            latencyP50Ms: 40,
            latencyP95Ms: 200,
            queueDepth: 3,
            diskUsedRatio: 0.4,
            migrationVersion: "0009",
            ...o.health,
          },
        }),
    usage: {
      runCount: 10,
      tokenCount: 1000,
      seatCount: 5,
      organizationCount: 1,
      skillPackRuns: [{ capabilityId: "WX-S021", runCount: 4 }],
    },
  };
  return { secret, report };
}
