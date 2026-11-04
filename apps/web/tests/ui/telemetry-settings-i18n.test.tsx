/** Component evidence: real API thin wrapper, mocked request boundary; no sending/auth claim. */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { instanceTelemetry as T } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { TelemetrySettingsScreen } from "@/components/admin/telemetry-settings-screen";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async () => ({
  ...await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client"),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));
const S = T.operations.getTelemetrySettings.path;
const L = T.operations.getLastTelemetryReport.path;
const U = T.operations.updateTelemetryConsent.path;
const items = T.TelemetryConsentItem.options;
const labels = { health: /health/i, usage: /usage/i, diagnostics: /diagnostic|error.*fingerprint/i, benchmark: /benchmark/i };
const consequences = {
  health: [/instance|health|alive/i, /proactive|fault|outage/i],
  usage: [/usage/i, /pricing|contract/i],
  diagnostics: [/export/i, /log/i],
  benchmark: [/benchmark|peer|baseline|feedback/i],
};
const settings = (state: T.TelemetryReporterStateValue = "enabled", consent = { ...T.TELEMETRY_CONSENT_DEFAULTS }) =>
  T.operations.getTelemetrySettings.out.parse({ state, consent, intervalSeconds: T.TELEMETRY_REPORT_INTERVAL_SECONDS });
// Validate, but retain the boundary object's intentionally non-schema property order.
const rawReport = {
  productVersion: "1.2.3", schemaVersion: 1, instanceId: "a".repeat(64), edition: "local",
  periodEnd: "2026-09-24T00:00:00.000Z", excludesPersonalLocalOrgs: true,
  consent: { health: true, usage: true, diagnostics: true, benchmark: true },
  health: { uptimeRatio: 0.99123456789, latencyP50Ms: 12, latencyP95Ms: 80, queueDepth: 0, diskUsedRatio: 0.3, migrationVersion: "0009" },
};
const attemptedAt = "2026-09-24T00:00:05.000Z";
function history(outcome: T.TelemetryAttemptOutcomeValue = "failed") {
  const omittedForLackOfData = outcome === "invalid" ? [...items] : items.filter((item) => item !== "health");
  const value = { last: { attemptedAt, outcome, omittedForLackOfData, report: outcome === "invalid" ? null : rawReport } };
  T.operations.getLastTelemetryReport.out.parse(value);
  return value;
}
function deferred<V>() {
  let resolve!: (value: V) => void;
  const promise = new Promise<V>((r) => { resolve = r; });
  return { promise, resolve };
}
function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>;
}
function show(locale: "en" | "zh-CN" = "zh-CN") {
  return render(<I18nProvider initialLocale={locale}><Language /><TelemetrySettingsScreen state="default" /></I18nProvider>);
}
const language = (locale: "en" | "zh-CN") => fireEvent.click(screen.getByText(locale === "en" ? "EN test" : "ZH test"));
const toggle = (item: T.TelemetryConsentItemValue) => screen.getByTestId(`admin-telemetry-toggle-${item}`);
function route(save?: () => unknown) {
  apiRequest.mockImplementation(async (path: string) => {
    if (path === S) return settings();
    if (path === L) return { last: null };
    if (path === U && save) return save();
    throw new Error(`Unexpected request: ${path}`);
  });
}
function readsOnly() {
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(apiRequest).toHaveBeenCalledWith(S);
  expect(apiRequest).toHaveBeenCalledWith(L);
}
beforeEach(() => { apiRequest.mockReset(); });
afterEach(() => { cleanup(); });

describe("telemetry settings complete localization", () => {
  it("renders complete English chrome, consequences, four accessible independent flags and interval", async () => {
    route(); show("en"); await screen.findByTestId("admin-telemetry-toggle-health");
    expect(screen.getByRole("heading", { name: /telemetry settings/i })).toBeTruthy();
    expect(screen.getByTestId("admin-telemetry-consent")).toHaveTextContent(/signal/i);
    expect(screen.getByTestId("admin-telemetry-interval-note")).toHaveTextContent(/next.*(?:period|cycle)/i);
    expect(screen.getByTestId("admin-telemetry-interval-note")).toHaveTextContent(/daily|every day|once a day/i);
    expect(screen.getByTestId("admin-telemetry-last-none")).toHaveTextContent(/no.*report|not.*report/i);
    for (const item of items) {
      expect(toggle(item)).toHaveAccessibleName(labels[item]);
      expect(toggle(item)).toHaveAttribute("aria-checked", String(T.TELEMETRY_CONSENT_DEFAULTS[item]));
      const consequence = screen.getByTestId(`admin-telemetry-if-off-${item}`);
      expect(consequence).toHaveTextContent(/off|disabl/i);
      for (const meaning of consequences[item]) expect(consequence).toHaveTextContent(meaning);
      expect(consequence.textContent!.length).toBeGreaterThan(20);
    }
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/);
    readsOnly();
  });

  it.each(T.TelemetryReporterState.options)("retranslates reporter state %s without a new read", async (state) => {
    apiRequest.mockImplementation(async (path: string) => path === S ? settings(state) : { last: null });
    show(); const panel = await screen.findByTestId(`admin-telemetry-state-${state}`);
    expect(panel).toHaveTextContent(/上报/);
    language("en"); expect(panel).toHaveTextContent(state === "enabled" ? /enabled/i : state === "endpoint_unset" ? /endpoint|address/i : /global|kill switch/i);
    expect(panel.textContent).not.toMatch(/[\u3400-\u9fff]/);
    language("zh-CN"); expect(panel).toHaveTextContent(/上报/);
    for (const item of items) expect(toggle(item)).toHaveAccessibleName(T.TELEMETRY_CONSENT_COPY[item].label);
    readsOnly();
  });

  it("retains both deferred reads through both locale directions and translates loading and empty separately", async () => {
    const pendingSettings = deferred<ReturnType<typeof settings>>();
    const pendingLast = deferred<{ last: null }>();
    apiRequest.mockImplementation((path: string) => path === S ? pendingSettings.promise : pendingLast.promise);
    show(); expect(screen.getByTestId("admin-telemetry-loading")).toHaveTextContent(/加载/);
    language("en");
    expect(screen.getByTestId("admin-telemetry-loading")).toHaveTextContent(/loading/i);
    expect(screen.getByTestId("admin-telemetry-last-loading")).toHaveTextContent(/loading/i);
    language("zh-CN"); readsOnly();
    await act(async () => { pendingSettings.resolve(settings()); });
    expect(toggle("health")).toHaveAccessibleName(T.TELEMETRY_CONSENT_COPY.health.label);
    expect(screen.queryByTestId("admin-telemetry-last-none")).toBeNull();
    language("en"); await act(async () => { pendingLast.resolve({ last: null }); });
    expect(screen.getByTestId("admin-telemetry-last-none")).toHaveTextContent(/no.*report|not.*report/i);
    readsOnly();
  });

  it.each(items)("owns deferred %s PUT across locale switches, locks all controls and uses authoritative response", async (item) => {
    const pending = deferred<ReturnType<typeof settings>>(); route(() => pending.promise); show();
    await screen.findByTestId("admin-telemetry-toggle-health");
    const original = toggle(item); fireEvent.click(original);
    for (const other of items) expect(toggle(other)).toBeDisabled();
    language("en"); expect(toggle(item)).toBe(original); fireEvent.click(toggle("benchmark"));
    expect(toggle(item)).toHaveAccessibleName(labels[item]);
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(apiRequest).toHaveBeenCalledWith(U, { method: T.operations.updateTelemetryConsent.method, body: { [item]: !T.TELEMETRY_CONSENT_DEFAULTS[item] } });
    // Server deliberately retains the old value, proving the UI is not optimistic.
    await act(async () => { pending.resolve(settings()); });
    for (const other of items) {
      expect(toggle(other)).not.toBeDisabled();
      expect(toggle(other)).toHaveAttribute("aria-checked", String(T.TELEMETRY_CONSENT_DEFAULTS[other]));
      expect(toggle(other)).toHaveAccessibleName(labels[other]);
    }
    language("zh-CN"); expect(toggle(item)).toBe(original);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it("applies four successful one-key writes independently and preserves them across language switches", async () => {
    let consent = { ...T.TELEMETRY_CONSENT_DEFAULTS };
    apiRequest.mockImplementation(async (path: string, options?: { body: Partial<typeof consent> }) => {
      if (path === S) return settings();
      if (path === L) return { last: null };
      if (path === U) { consent = { ...consent, ...options?.body }; return settings("enabled", consent); }
      throw new Error(`Unexpected request: ${path}`);
    });
    show(); await screen.findByTestId("admin-telemetry-toggle-health");
    for (const [index, item] of items.entries()) {
      fireEvent.click(toggle(item));
      await act(async () => { await Promise.resolve(); });
      language(index % 2 === 0 ? "en" : "zh-CN");
      for (const other of items) expect(toggle(other)).toHaveAttribute("aria-checked", String(consent[other]));
      expect(apiRequest).toHaveBeenCalledTimes(3 + index);
      expect(apiRequest).toHaveBeenLastCalledWith(U, { method: "PUT", body: { [item]: !T.TELEMETRY_CONSENT_DEFAULTS[item] } });
    }
    language("en"); expect(toggle("usage")).toHaveAccessibleName(labels.usage);
    expect(apiRequest).toHaveBeenCalledTimes(6);
  });

  it.each(T.TelemetryAttemptOutcome.options)("preserves raw report, timestamp and identifiers while translating outcome %s and omitted labels", async (outcome) => {
    const input = history(outcome); apiRequest.mockImplementation(async (path: string) => path === S ? settings() : input);
    show(); const result = await screen.findByTestId(`admin-telemetry-last-outcome-${outcome}`);
    const chineseTime = result.textContent!.split(" · ")[0];
    language("en");
    expect(result).toHaveTextContent(outcome === "sent" ? /sent.*confirm/i : outcome === "failed" ? /failed.*discard|failed.*retry/i : /validat.*not sent|invalid/i);
    expect(result.textContent).not.toMatch(/[\u3400-\u9fff]/);
    for (const item of input.last.omittedForLackOfData) expect(screen.getByTestId("admin-telemetry-last-omitted")).toHaveTextContent(labels[item]);
    if (outcome === "invalid") expect(screen.getByTestId("admin-telemetry-last-no-body")).toHaveTextContent(/nothing.*sent|no.*sent/i);
    else expect(screen.getByTestId("admin-telemetry-last-body").textContent).toBe(JSON.stringify(rawReport, null, 2));
    language("zh-CN"); expect(result.textContent!.split(" · ")[0]).toBe(chineseTime);
    for (const item of input.last.omittedForLackOfData) expect(screen.getByTestId("admin-telemetry-last-omitted")).toHaveTextContent(T.TELEMETRY_CONSENT_COPY[item].label);
    expect(input.last.attemptedAt).toBe(attemptedAt);
    if (outcome !== "invalid") expect(screen.getByTestId("admin-telemetry-last-body").textContent).toBe(JSON.stringify(rawReport, null, 2));
    readsOnly();
  });

  const privateDetail = "PRIVATE_TELEMETRY_TOKEN_xyz";
  const errors = [
    ["permission", () => new ApiError(403, "NOT_PLATFORM_SUPERUSER", { message: privateDetail }), /platform.*(?:operator|administrator|superuser)/i],
    ["validation", () => new ApiError(400, "VALIDATION_FAILED", { message: privateDetail }), /validat|refresh/i],
    ["network", () => new TypeError(privateDetail), /network|connect/i],
    ["unknown", () => new Error(privateDetail), /try again|wrong|failed/i],
    ["server", () => new ApiError(503, privateDetail, { message: privateDetail }), null],
  ] as const;
  it.each(errors)("retranslates %s save failure after entering the real mutation branch, retaining every flag", async (_kind, error, english) => {
    route(() => { throw error(); }); show(); await screen.findByTestId("admin-telemetry-toggle-health");
    fireEvent.click(toggle("usage")); const failure = await screen.findByTestId("admin-telemetry-save-failed-usage");
    const chinese = failure.textContent; language("en");
    expect(failure).toHaveTextContent(english ?? httpFailureText(503, "en"));
    expect(failure).toHaveTextContent(/not.*sav|sav.*fail/i);
    expect(failure.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(document.body).not.toHaveTextContent(privateDetail);
    for (const item of items) expect(toggle(item)).toHaveAttribute("aria-checked", String(T.TELEMETRY_CONSENT_DEFAULTS[item]));
    language("zh-CN"); expect(failure.textContent).toBe(chinese);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it.each(errors.filter(([kind]) => kind !== "validation"))("keeps %s read failures distinct from empty and retranslates safe causes", async (_kind, error, english) => {
    apiRequest.mockRejectedValue(error()); show();
    const settingsFailure = await screen.findByTestId("admin-telemetry-failed");
    const lastFailure = await screen.findByTestId("admin-telemetry-last-failed");
    const original = settingsFailure.textContent; language("en");
    for (const failure of [settingsFailure, lastFailure]) {
      expect(failure).toHaveTextContent(english ?? httpFailureText(503, "en"));
      expect(failure.textContent).not.toMatch(/[\u3400-\u9fff]/);
    }
    expect(document.body).not.toHaveTextContent(privateDetail);
    expect(screen.queryByTestId("admin-telemetry-last-none")).toBeNull();
    expect(screen.queryByTestId("admin-telemetry-toggle-health")).toBeNull();
    language("zh-CN"); expect(settingsFailure.textContent).toBe(original); readsOnly();
  });
});
