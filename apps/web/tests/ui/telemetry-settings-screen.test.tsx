/**
 * D9 —— 实例「上报设置」页。文案一律从契约取，测试里不抄字符串。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { instanceTelemetry as T } from "@repo/contracts";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { TelemetrySettingsScreen } from "@/components/admin/telemetry-settings-screen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const S = T.operations.getTelemetrySettings.path;
const U = T.operations.updateTelemetryConsent.path;
const L = T.operations.getLastTelemetryReport.path;

const settings = (consent = { ...T.TELEMETRY_CONSENT_DEFAULTS }, state: "enabled" | "endpoint_unset" | "kill_switch" = "enabled") =>
  ({ consent, state, intervalSeconds: T.TELEMETRY_REPORT_INTERVAL_SECONDS });

const report = T.InstanceTelemetryReport.parse({
  schemaVersion: 1,
  instanceId: "a".repeat(64),
  edition: "local",
  productVersion: "1.2.3",
  periodEnd: "2026-09-24T00:00:00.000Z",
  excludesPersonalLocalOrgs: true,
  consent: { health: true, usage: true, diagnostics: false, benchmark: false },
  health: { uptimeRatio: 0.99, latencyP50Ms: 12, latencyP95Ms: 80, queueDepth: 0, diskUsedRatio: 0.3, migrationVersion: "0009" },
});

describe("D9 上报设置页", () => {
  it("四个开关、契约原文 ifOff、上报状态、下一周期生效提示；最近一次报告原样展示", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === S) return settings(undefined, "endpoint_unset");
      if (path === L) return { last: { attemptedAt: "2026-09-24T00:00:05.000Z", outcome: "failed", omittedForLackOfData: ["usage"], report } };
      throw new Error(`unexpected ${path}`);
    });
    render(<TelemetrySettingsScreen state="default" />);

    for (const item of T.TelemetryConsentItem.options) {
      const toggle = await screen.findByTestId(`admin-telemetry-toggle-${item}`);
      expect(toggle.getAttribute("aria-checked")).toBe(String(T.TELEMETRY_CONSENT_DEFAULTS[item]));
      expect(toggle.getAttribute("aria-label")).toBe(T.TELEMETRY_CONSENT_COPY[item].label);
      expect(screen.getByTestId(`admin-telemetry-if-off-${item}`).textContent).toContain(T.TELEMETRY_CONSENT_COPY[item].ifOff);
    }
    expect(screen.getByTestId("admin-telemetry-state-endpoint_unset")).toBeTruthy();
    expect(screen.getByTestId("admin-telemetry-interval-note").textContent).toContain("下一个周期");

    expect(await screen.findByTestId("admin-telemetry-last-outcome-failed")).toBeTruthy();
    expect(screen.getByTestId("admin-telemetry-last-body").textContent).toBe(JSON.stringify(report, null, 2));
    expect(screen.getByTestId("admin-telemetry-last-omitted").textContent).toContain(T.TELEMETRY_CONSENT_COPY.usage.label);
  });

  it("点开关只 PUT 那一项；失败时如实报错、开关保持原值，不显示成功", async () => {
    const { ApiError } = await import("@/lib/api-client");
    let fail = false;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, boolean> }) => {
      if (path === S) return settings();
      if (path === L) return { last: null };
      if (path === U) {
        expect(opts?.method).toBe("PUT");
        if (fail) throw new ApiError(500, "INTERNAL", {});
        return settings({ ...T.TELEMETRY_CONSENT_DEFAULTS, ...opts?.body });
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<TelemetrySettingsScreen state="default" />);
    expect(await screen.findByTestId("admin-telemetry-last-none")).toBeTruthy();

    fireEvent.click(await screen.findByTestId("admin-telemetry-toggle-usage"));
    await waitFor(() => expect(screen.getByTestId("admin-telemetry-toggle-usage").getAttribute("aria-checked")).toBe("true"));
    expect(apiRequest).toHaveBeenCalledWith(U, { method: "PUT", body: { usage: true } });

    fail = true;
    fireEvent.click(screen.getByTestId("admin-telemetry-toggle-benchmark"));
    const err = await screen.findByTestId("admin-telemetry-save-failed-benchmark");
    expect(err.textContent).not.toContain("INTERNAL");
    expect(screen.getByTestId("admin-telemetry-toggle-benchmark").getAttribute("aria-checked")).toBe("false");
  });

  it("非超管：显示身份说明，不渲染开关", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async () => { throw new ApiError(403, "NOT_PLATFORM_SUPERUSER", {}); });
    render(<TelemetrySettingsScreen state="default" />);
    const failed = await screen.findByTestId("admin-telemetry-failed");
    expect(failed.textContent).not.toContain("NOT_PLATFORM_SUPERUSER");
    expect(screen.queryByTestId("admin-telemetry-toggle-health")).toBeNull();
  });
});
